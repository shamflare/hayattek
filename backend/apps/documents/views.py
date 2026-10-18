import re

from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
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
from .scanning import INLINE_TYPES, get_scanner, inspect_upload
from .tasks import run_ocr


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
    parser_classes = [MultiPartParser, FormParser]

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
        if not get_scanner().scan(uploaded):
            raise DomainError(_("تم رفض الملف لأسباب أمنية."), code="malware_detected")

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

        with transaction.atomic():
            document = ClinicalDocument(
                patient=patient, category=v["category"], title=v["title"],
                description=v.get("description", ""), document_date=v.get("document_date"),
                original_filename=_safe_filename(uploaded.name),
                scan_status=ScanStatus.CLEAN, status=RecordStatus.FINAL,
                finalized_at=timezone.now(), **meta, **provenance, **links,
            )
            document.file.save("upload", uploaded, save=False)
            document.save()
            audit.record(audit.Action.DOCUMENT_UPLOAD, request=request, ctx=ctx,
                         target=document, metadata={"mime": meta["mime_type"],
                                                    "size": meta["size_bytes"]})
        if v.get("run_ocr") and meta["mime_type"] != "application/dicom":
            transaction.on_commit(lambda: run_ocr.delay(str(document.pk)))
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
        if document.scan_status != ScanStatus.CLEAN:
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

