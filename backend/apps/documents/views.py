import logging
import re

from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.access import policy
from apps.audit import services as audit
from apps.clinical import records
from apps.clinical.api import ClinicalRecordViewSet, RecordMetaSerializer
from apps.clinical.base import RecordSource, RecordStatus
from apps.core.exceptions import DomainError
from apps.organizations.models import Role
from apps.patients.models import Patient

from .models import ClinicalDocument, DocumentCategory, ScanStatus
from .ocr_service import schedule_ocr
from .scanning import INLINE_TYPES, apply_verdict, inspect_upload, run_scan
from .tasks import scan_document_task

logger = logging.getLogger("hayat.scan")


class DocumentSerializer(RecordMetaSerializer):
    ocr_status = serializers.CharField(source="ocr.status", read_only=True, default=None)

    class Meta:
        model = ClinicalDocument
        fields = (*RecordMetaSerializer.META_FIELDS, "category", "title", "description",
                  "original_filename", "mime_type", "size_bytes", "scan_status",
                  "document_date", "encounter", "lab_report", "imaging_report", "ocr_status")
        read_only_fields = fields


class DocumentUploadSerializer(serializers.Serializer):
    patient = serializers.UUIDField()
    file = serializers.FileField()
    category = serializers.ChoiceField(choices=DocumentCategory.choices)
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(max_length=500, required=False, allow_blank=True)
    document_date = serializers.DateField(required=False, allow_null=True)
    encounter = serializers.UUIDField(required=False, allow_null=True)
    lab_report = serializers.UUIDField(required=False, allow_null=True)
    imaging_report = serializers.UUIDField(required=False, allow_null=True)
    run_ocr = serializers.BooleanField(default=False)


_SAFE_NAME = re.compile(r"[^\w.\- ؀-ۿ]")


def _safe_filename(name: str) -> str:
    return _SAFE_NAME.sub("_", name or "")[-150:]


class DocumentViewSet(ClinicalRecordViewSet):
    model = ClinicalDocument
    read_serializer_class = DocumentSerializer
    write_serializer_class = DocumentUploadSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def filter_list(self, qs):
        category = self.request.query_params.get("category")
        return qs.filter(category__in=category.split(",")) if category else qs

    @extend_schema(request={"multipart/form-data": DocumentUploadSerializer},
                   responses={201: DocumentSerializer})
    def create(self, request):
        data = DocumentUploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        uploaded = v.pop("file")
        meta = inspect_upload(uploaded)

        ctx = self.ctx
        links = {}
        if ctx is not None:
            if not (ctx.is_clinician or ctx.has_role(Role.LAB_STAFF, Role.IMAGING_STAFF)):
                raise DomainError(_("لا تملك صلاحية رفع المستندات."), code="forbidden",
                                  status_code=403)
            patient = self.get_patient_for_write(v["patient"])
            records.ensure_can_author(ctx, patient.pk)
            links = self._resolve_links(ctx, patient, v)
            provenance = records.author_fields(
                ctx, RecordSource.CLINICIAN if ctx.is_clinician else
                (RecordSource.LABORATORY if ctx.has_role(Role.LAB_STAFF) else RecordSource.IMAGING))
        else:
            if not policy.user_can_access_patient(request.user, v["patient"], manage_sharing=True):
                raise DomainError(_("المريض غير موجود أو لا تملك صلاحية الوصول إليه."),
                                  code="not_found", status_code=404)
            patient = Patient.objects.get(pk=v["patient"])
            provenance = {"organization": None, "author": request.user, "practitioner": None,
                          "author_role": "patient", "source": RecordSource.PATIENT}

        # Attachments of a draft report stay drafts until the report is approved, so nobody
        # (including the patient) sees a result file before the result itself.
        parent = links.get("lab_report") or links.get("imaging_report")
        is_draft = parent is not None and parent.status == RecordStatus.DRAFT
        # Malware scan (SECURITY_MODEL §7) before anything is stored: infected bytes never
        # reach storage. No verdict (scanner down) -> stored quarantined, retried later.
        verdict = run_scan(uploaded)
        infected = verdict is not None and not verdict.clean
        with transaction.atomic():
            document = ClinicalDocument(
                patient=patient, category=v["category"], title=v["title"],
                description=v.get("description", ""), document_date=v.get("document_date"),
                original_filename=_safe_filename(uploaded.name),
                scan_status=ScanStatus.PENDING,  # quarantined until the scanner says clean
                status=RecordStatus.DRAFT if is_draft else RecordStatus.FINAL,
                finalized_at=None if is_draft else timezone.now(), **meta, **provenance, **links,
            )
            if not infected:
                document.file.save("upload", uploaded, save=False)
            document.save()
            audit.record(audit.Action.DOCUMENT_UPLOAD, request=request, ctx=ctx,
                         target=document, metadata={"mime": meta["mime_type"],
                                                    "size": meta["size_bytes"]})
            scan_status = (apply_verdict(document, verdict, request=request, ctx=ctx)
                           if verdict is not None else ScanStatus.PENDING)
        if scan_status == ScanStatus.REJECTED:
            raise DomainError(_("تم رفض الملف لأسباب أمنية."), code="malware_detected",
                              status_code=422)
        want_ocr = bool(v.get("run_ocr")) and meta["mime_type"] != "application/dicom"
        try:
            if scan_status == ScanStatus.PENDING:
                scan_document_task.apply_async((str(document.pk), 0, want_ocr), countdown=30)
            elif want_ocr:
                transaction.on_commit(lambda: schedule_ocr(document.pk, user=request.user))
        except Exception:  # broker down: the periodic sweeper rescans pending files
            logger.exception("could not enqueue post-upload task document=%s", document.pk)
        return Response(DocumentSerializer(document, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)

    def _resolve_links(self, ctx, patient, v) -> dict:
        from apps.clinical.models import Encounter
        from apps.diagnostics.models import ImagingReport, LabReport

        links = {}
        for field, model in (("encounter", Encounter), ("lab_report", LabReport),
                             ("imaging_report", ImagingReport)):
            if v.get(field):
                obj = policy.visible_records(ctx, patient.pk, model).filter(pk=v[field]).first()
                if obj is None or obj.organization_id != ctx.organization.pk:
                    raise DomainError(_("السجل المرتبط غير صالح."), code="invalid_link")
                links[field] = obj
        return links

    def partial_update(self, request, pk=None):
        raise DomainError(_("لا يمكن تعديل المستند. ارفع نسخة جديدة وألغِ القديمة."),
                          code="immutable", status_code=405)

    @extend_schema(responses={(200, "application/octet-stream"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        document = self.get_record(pk)
        if document.scan_status == ScanStatus.REJECTED:
            raise DomainError(_("رُفض هذا الملف في الفحص الأمني ولا يمكن فتحه."),
                              code="file_rejected", status_code=409)
        if document.scan_status != ScanStatus.CLEAN or not document.file:
            raise DomainError(_("الملف قيد الفحص الأمني."), code="not_ready", status_code=409)
        audit.record(audit.Action.DOCUMENT_DOWNLOAD, request=request, ctx=self.ctx,
                     target=document)
        inline = document.mime_type in INLINE_TYPES and request.query_params.get("download") != "1"
        ext = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
               "image/webp": "webp", "image/tiff": "tiff", "image/heic": "heic",
               "application/dicom": "dcm"}.get(document.mime_type, "bin")
        response = FileResponse(document.file.open("rb"), content_type=document.mime_type,
                                as_attachment=not inline, filename=f"hayat-document.{ext}")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        return response

