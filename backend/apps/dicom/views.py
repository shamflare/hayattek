"""Authorized DICOM endpoints. The browser never talks to Orthanc (ADR-030).

Every request resolves the ClinicalDocument through the same policy functions as the documents
API (staff with X-Hayat-Membership → `policy.visible_records`; patients/guardians without it →
`policy.patient_visible_records`), and only then touches the image store using internal ids
that are never sent to the client.
"""

from __future__ import annotations

import hashlib
import logging

from django.db import transaction
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.access import policy
from apps.access.context import resolve_practice_context
from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.clinical import records
from apps.clinical.base import RecordSource, RecordStatus
from apps.core.exceptions import DomainError
from apps.documents.models import IMAGING_CATEGORIES, ClinicalDocument, ScanStatus
from apps.documents.scanning import apply_verdict, run_scan
from apps.documents.tasks import scan_document_task
from apps.documents.views import (
    DocumentSerializer,
    DocumentUploadSerializer,
    DocumentViewSet,
    _safe_filename,
)
from apps.organizations.models import Role
from apps.patients.models import Patient

from . import archive
from .models import DICOM_MIMES, DICOM_ZIP_MIME, DicomInstance, DicomSeries, DicomStudy, StudyStatus
from .orthanc import OrthancError, get_client
from .services import ensure_study

logger = logging.getLogger(__name__)

VIEW_DICOM = "document.view_dicom"

NOT_FOUND = DomainError(_("الدراسة غير موجودة أو لا تملك صلاحية الوصول إليها."),
                        code="not_found", status_code=404)

# Display presets (window center / width, Hounsfield units for CT).
WINDOW_PRESETS = {
    "soft_tissue": (40, 400),
    "lung": (-600, 1500),
    "bone": (300, 2000),
    "brain": (40, 80),
    "abdomen": (60, 350),
}


# ---------------------------------------------------------------- serializers


class DicomStudySerializer(serializers.ModelSerializer):
    document = serializers.UUIDField(source="document_id", read_only=True)
    patient = serializers.UUIDField(source="document.patient_id", read_only=True)
    encounter = serializers.UUIDField(source="document.encounter_id", read_only=True,
                                      allow_null=True)
    imaging_report = serializers.UUIDField(source="document.imaging_report_id", read_only=True,
                                           allow_null=True)
    title = serializers.CharField(source="document.title", read_only=True)
    category = serializers.CharField(source="document.category", read_only=True)
    organization_name = serializers.CharField(source="document.organization.name", read_only=True,
                                              default=None, allow_null=True)
    record_status = serializers.CharField(source="document.status", read_only=True)
    window_presets = serializers.SerializerMethodField()
    diagnostic_use = serializers.SerializerMethodField()

    class Meta:
        model = DicomStudy
        fields = ("id", "document", "patient", "encounter", "imaging_report", "title", "category",
                  "organization_name", "record_status", "status", "error_code", "modalities",
                  "study_date", "study_description", "series_count", "instance_count",
                  "stored_at", "window_presets", "diagnostic_use")
        read_only_fields = fields

    def get_window_presets(self, obj) -> list[str]:
        return ["default", *WINDOW_PRESETS]

    def get_diagnostic_use(self, obj) -> bool:
        """Always false: this viewer is for review only, not cleared for clinical diagnosis."""
        return False


class DicomSeriesSerializer(serializers.ModelSerializer):
    class Meta:
        model = DicomSeries
        fields = ("id", "modality", "number", "description", "instance_count")
        read_only_fields = fields


class DicomInstanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DicomInstance
        fields = ("id", "instance_number", "frames")
        read_only_fields = fields


def _paginated(name: str, item):
    return inline_serializer(name, {
        "count": serializers.IntegerField(),
        "next": serializers.URLField(allow_null=True),
        "previous": serializers.URLField(allow_null=True),
        "results": item(many=True),
    })


class SeriesPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class InstancePagination(PageNumberPagination):
    page_size = 200
    page_size_query_param = "page_size"
    max_page_size = 1000


# ---------------------------------------------------------------- access


class DicomAccessMixin:
    lookup_value_regex = "[0-9a-f-]{36}"

    @property
    def ctx(self):
        return resolve_practice_context(self.request)

    def get_document(self, document_id) -> ClinicalDocument:
        """Exactly the documents API visibility rules; 404 (and an audit row) otherwise."""
        import uuid

        try:
            pk = uuid.UUID(str(document_id))
        except ValueError:
            raise NOT_FOUND from None
        row = ClinicalDocument.objects.filter(pk=pk).values("patient_id").first()
        document = None
        if row:
            ctx = self.ctx
            qs = (policy.visible_records(ctx, row["patient_id"], ClinicalDocument) if ctx
                  else policy.patient_visible_records(self.request.user, row["patient_id"],
                                                      ClinicalDocument))
            document = qs.filter(pk=pk, mime_type__in=DICOM_MIMES).first()
        if document is None:
            audit.record(audit.Action.ACCESS_DENIED, request=self.request, ctx=self.ctx,
                         outcome=AuditOutcome.DENIED, target_type="documents.clinicaldocument",
                         target_id=str(pk), patient_id=row["patient_id"] if row else None,
                         metadata={"via": "dicom"})
            raise NOT_FOUND
        return document

    def get_study(self, document_id, *, require_stored=True, lazy_ingest=False) -> DicomStudy:
        document = self.get_document(document_id)
        # Lazy ingest covers documents uploaded before this feature or scanned clean by a
        # bulk update that bypassed post_save. Only on the study-open request.
        study = ensure_study(document) if lazy_ingest else (
            DicomStudy.objects.filter(document=document).first())
        if study is None:
            raise DomainError(_("الملف قيد الفحص الأمني."), code="not_ready", status_code=409)
        study.document = document
        if require_stored and study.status != StudyStatus.STORED:
            raise DomainError(_("الدراسة غير جاهزة للعرض بعد."), code="study_not_ready",
                              status_code=409)
        return study


# ---------------------------------------------------------------- viewer API


class DicomStudyViewSet(DicomAccessMixin, viewsets.GenericViewSet):
    """Read-only viewer API, addressed by the ClinicalDocument id."""

    queryset = DicomStudy.objects.none()
    serializer_class = DicomStudySerializer
    pagination_class = None

    def retrieve(self, request, pk=None):
        """Study information. Audited once per study open (`document.view_dicom`)."""
        study = self.get_study(pk, require_stored=False, lazy_ingest=True)
        study.refresh_from_db()  # a synchronous (dev) push may have just completed
        if study.status == StudyStatus.STORED:
            # Images become viewable from here; frames themselves are not audited one by one.
            audit.record(VIEW_DICOM, request=request, ctx=self.ctx, target=study.document,
                         metadata={"series": study.series_count,
                                   "instances": study.instance_count})
        return Response(DicomStudySerializer(study).data)

    @extend_schema(responses=_paginated("PaginatedDicomSeriesList", DicomSeriesSerializer),
                   parameters=[OpenApiParameter("page", int), OpenApiParameter("page_size", int)])
    def series(self, request, pk=None):
        study = self.get_study(pk)
        paginator = SeriesPagination()
        page = paginator.paginate_queryset(study.series.all(), request, view=self)
        return paginator.get_paginated_response(DicomSeriesSerializer(page, many=True).data)

    @extend_schema(responses=_paginated("PaginatedDicomInstanceList", DicomInstanceSerializer),
                   parameters=[OpenApiParameter("page", int), OpenApiParameter("page_size", int)])
    def instances(self, request, pk=None, series_id=None):
        study = self.get_study(pk)
        series = study.series.filter(pk=series_id).first()
        if series is None:
            raise NOT_FOUND
        paginator = InstancePagination()
        page = paginator.paginate_queryset(series.instances.all(), request, view=self)
        return paginator.get_paginated_response(DicomInstanceSerializer(page, many=True).data)

    @extend_schema(
        parameters=[
            OpenApiParameter("frame", int, description="0-based frame index"),
            OpenApiParameter("preset", str, enum=["default", *WINDOW_PRESETS]),
            OpenApiParameter("wc", float, description="window center (with ww)"),
            OpenApiParameter("ww", float, description="window width (with wc)"),
            OpenApiParameter("fmt", str, enum=["png", "jpeg"]),
        ],
        responses={(200, "image/png"): OpenApiTypes.BINARY,
                   (200, "image/jpeg"): OpenApiTypes.BINARY})
    def rendered(self, request, pk=None, instance_id=None):
        """One rendered frame (8-bit display image), streamed from the private store."""
        study = self.get_study(pk)
        instance = DicomInstance.objects.filter(pk=instance_id, series__study=study).first()
        if instance is None:
            raise NOT_FOUND
        q = request.query_params
        frame = _bounded_int(q.get("frame", "0"), 0, instance.frames - 1)
        center, width = _window(q)
        accept = "image/jpeg" if q.get("fmt") == "jpeg" else "image/png"
        try:
            upstream = get_client().rendered_frame(instance.orthanc_id, frame, accept=accept,
                                                   window_center=center, window_width=width,
                                                   quality=90)
        except OrthancError as exc:
            raise DomainError(_("تعذر جلب الصورة من مخزن الصور."), code="store_unavailable",
                              status_code=502) from exc

        def body():
            try:
                yield from upstream.stream(64 * 1024)
            finally:
                upstream.release_conn()

        response = StreamingHttpResponse(body(), content_type=accept)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response


def _bounded_int(raw, low: int, high: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise DomainError(_("قيمة غير صالحة."), code="invalid_param") from None
    if not low <= value <= high:
        raise DomainError(_("رقم الإطار خارج النطاق."), code="invalid_param")
    return value


def _window(q) -> tuple[float | None, float | None]:
    preset = q.get("preset", "default")
    if q.get("wc") is not None and q.get("ww") is not None:
        try:
            center, width = float(q["wc"]), float(q["ww"])
        except ValueError:
            raise DomainError(_("قيمة غير صالحة."), code="invalid_param") from None
        if not (-5000 <= center <= 5000 and 1 <= width <= 10000):
            raise DomainError(_("قيم النافذة خارج النطاق."), code="invalid_param")
        return center, width
    if preset == "default":
        return None, None
    if preset not in WINDOW_PRESETS:
        raise DomainError(_("إعداد عرض غير معروف."), code="invalid_param")
    return WINDOW_PRESETS[preset]


# ---------------------------------------------------------------- upload


class DicomUploadSerializer(DocumentUploadSerializer):
    file = serializers.FileField(help_text="One DICOM file (.dcm) or a ZIP of ONE DICOM study.")


class DicomUploadViewSet(DocumentViewSet):
    """Upload a DICOM study. Single `.dcm` files go through the regular documents pipeline;
    a ZIP of one study is validated here (limits, zip-slip, one StudyInstanceUID)."""

    write_serializer_class = DicomUploadSerializer
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request={"multipart/form-data": DicomUploadSerializer},
                   responses={201: DocumentSerializer})
    def create(self, request):
        data = DicomUploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        if v["category"] not in IMAGING_CATEGORIES:
            raise DomainError(_("اختر تصنيف أشعة/تصوير لدراسة DICOM."), code="invalid_category")
        uploaded = v.pop("file")
        uploaded.seek(0)
        head = uploaded.read(4)
        uploaded.seek(0)
        if not archive.is_zip(head):
            return super().create(request)  # regular documents path (sniffs application/dicom)
        return self._create_zip(request, v, uploaded)

    def _create_zip(self, request, v, uploaded):
        max_bytes = archive.limits()["zip_max_bytes"]
        if uploaded.size > max_bytes:
            raise DomainError(_("حجم الأرشيف أكبر من المسموح (%(mb)s ميغابايت).")
                              % {"mb": max_bytes // (1024 * 1024)}, code="file_too_large")
        summary = archive.validate_zip(uploaded)
        digest = hashlib.sha256()
        for chunk in uploaded.chunks():
            digest.update(chunk)
        uploaded.seek(0)

        ctx = self.ctx
        links = {}
        if ctx is not None:
            if not (ctx.is_clinician or ctx.has_role(Role.IMAGING_STAFF)):
                raise DomainError(_("لا تملك صلاحية رفع الدراسات."), code="forbidden",
                                  status_code=403)
            patient = self.get_patient_for_write(v["patient"])
            records.ensure_can_author(ctx, patient.pk)
            links = self._resolve_links(ctx, patient, v)
            provenance = records.author_fields(
                ctx, RecordSource.CLINICIAN if ctx.is_clinician else RecordSource.IMAGING)
        else:
            if not policy.user_can_access_patient(request.user, v["patient"], manage_sharing=True):
                raise DomainError(_("المريض غير موجود أو لا تملك صلاحية الوصول إليه."),
                                  code="not_found", status_code=404)
            patient = Patient.objects.get(pk=v["patient"])
            provenance = {"organization": None, "author": request.user, "practitioner": None,
                          "author_role": "patient", "source": RecordSource.PATIENT}

        parent = links.get("lab_report") or links.get("imaging_report")
        is_draft = parent is not None and parent.status == RecordStatus.DRAFT
        # Same quarantine model as the documents API (SECURITY_MODEL §7): stored pending,
        # released by the scanner verdict; the push to Orthanc happens only once clean.
        verdict = run_scan(uploaded)
        infected = verdict is not None and not verdict.clean
        with transaction.atomic():
            document = ClinicalDocument(
                patient=patient, category=v["category"], title=v["title"],
                description=v.get("description", ""), document_date=v.get("document_date"),
                original_filename=_safe_filename(uploaded.name), mime_type=DICOM_ZIP_MIME,
                size_bytes=uploaded.size, sha256=digest.hexdigest(),
                scan_status=ScanStatus.PENDING,
                status=RecordStatus.DRAFT if is_draft else RecordStatus.FINAL,
                finalized_at=None if is_draft else timezone.now(), **provenance, **links,
            )
            if not infected:
                document.file.save("upload", uploaded, save=False)
            document.save()  # post_save → DicomStudy row (apps.dicom.signals)
            audit.record(audit.Action.DOCUMENT_UPLOAD, request=request, ctx=ctx,
                         target=document, metadata={"mime": DICOM_ZIP_MIME,
                                                    "size": uploaded.size,
                                                    "files": summary.file_count})
            # clean → document_scanned_clean → push (apps.dicom.signals)
            scan_status = (apply_verdict(document, verdict, request=request, ctx=ctx)
                           if verdict is not None else ScanStatus.PENDING)
        if scan_status == ScanStatus.REJECTED:
            raise DomainError(_("تم رفض الملف لأسباب أمنية."), code="malware_detected",
                              status_code=422)
        if scan_status == ScanStatus.PENDING:
            try:
                scan_document_task.apply_async((str(document.pk), 0, False), countdown=30)
            except Exception:  # broker down: the periodic sweeper rescans pending files
                logger.exception("could not enqueue scan document=%s", document.pk)
        return Response(DocumentSerializer(document, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

