"""OCR review workflow (PHASE2 §4).

GET  /documents/{id}/ocr                       suggestion + status
POST /documents/{id}/ocr/run                   (re)run OCR on a clean document
POST /documents/{id}/ocr/convert-to-lab-report reviewer-submitted values → DRAFT LabReport

Only staff who may author for the patient (clinicians, lab/imaging staff) use these
endpoints. The server never copies machine-extracted rows into a report: the request body
carries the reviewed values. The report stays a draft until finalized by its author through
the existing /diagnostics/lab-reports/{id}/finalize endpoint.
"""

from __future__ import annotations

import zoneinfo
from datetime import datetime, time
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.access import policy
from apps.access.context import resolve_practice_context
from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.clinical import records
from apps.clinical.api import _parse_uuid
from apps.clinical.base import RecordSource
from apps.core.exceptions import DomainError
from apps.diagnostics.models import LabObservation, LabReport
from apps.diagnostics.serializers import LabObservationSerializer, LabReportSerializer
from apps.organizations.models import Role

from .models import ClinicalDocument, OcrResult, OcrStatus, ScanStatus
from .ocr_service import is_ocr_supported, schedule_ocr

NOT_FOUND = DomainError(_("المستند غير موجود أو لا تملك صلاحية الوصول إليه."),
                        code="not_found", status_code=404)


class OcrResultSerializer(serializers.ModelSerializer):
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True,
                                             default=None, allow_null=True)
    document_title = serializers.CharField(source="document.title", read_only=True)
    document_mime_type = serializers.CharField(source="document.mime_type", read_only=True)
    patient = serializers.UUIDField(source="document.patient_id", read_only=True)
    lab_report_status = serializers.CharField(source="lab_report.status", read_only=True,
                                              default=None, allow_null=True)

    class Meta:
        model = OcrResult
        fields = ("id", "document", "document_title", "document_mime_type", "patient",
                  "status", "error_code", "provider", "engine", "engine_version", "pages",
                  "text", "mean_confidence", "suggested_category", "extracted", "processed_at",
                  "reviewed_at", "reviewed_by_name", "lab_report", "lab_report_status",
                  "created_at", "updated_at")
        read_only_fields = fields


class OcrConvertSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    external_lab_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    result_date = serializers.DateField(required=False, allow_null=True,
                                        help_text="Date printed on the report (reviewed).")
    conclusion = serializers.CharField(required=False, allow_blank=True)
    observations = LabObservationSerializer(many=True)

    def validate_observations(self, value):
        if not value:
            raise serializers.ValidationError(_("أضف نتيجة واحدة على الأقل بعد المراجعة."))
        return value


def _staff_ctx(request):
    ctx = resolve_practice_context(request)
    if ctx is None or not (ctx.is_clinician or ctx.has_role(Role.LAB_STAFF, Role.IMAGING_STAFF)):
        raise DomainError(_("مراجعة القراءة الآلية متاحة للأطباء وطاقم المختبر والتصوير."),
                          code="forbidden", status_code=403)
    return ctx


def _document_for(request, ctx, pk) -> ClinicalDocument:
    pk = _parse_uuid(pk)
    row = ClinicalDocument.objects.filter(pk=pk).values("patient_id").first() if pk else None
    document = (policy.visible_records(ctx, row["patient_id"], ClinicalDocument)
                .filter(pk=pk).first() if row else None)
    if document is None:
        audit.record(audit.Action.ACCESS_DENIED, request=request, ctx=ctx,
                     outcome=AuditOutcome.DENIED, target_type="documents.clinicaldocument",
                     target_id=str(pk), patient_id=row["patient_id"] if row else None)
        raise NOT_FOUND
    return document


def _ensure_reviewable(ctx, document: ClinicalDocument) -> None:
    records.ensure_can_author(ctx, document.patient_id)
    if document.scan_status != ScanStatus.CLEAN or not document.file:
        raise DomainError(_("لا يمكن قراءة الملف قبل اجتياز الفحص الأمني."),
                          code="not_ready", status_code=409)


class DocumentOcrView(APIView):
    @extend_schema(responses=OcrResultSerializer, operation_id="documents_ocr_retrieve")
    def get(self, request, pk):
        ctx = _staff_ctx(request)
        document = _document_for(request, ctx, pk)
        result = OcrResult.objects.select_related("reviewed_by", "lab_report", "document").filter(
            document=document).first()
        if result is None:
            raise DomainError(_("لم تُشغَّل القراءة الآلية لهذا المستند بعد."),
                              code="ocr_not_found", status_code=404)
        audit.record(audit.Action.DOCUMENT_OCR_VIEW, request=request, ctx=ctx, target=document)
        return Response(OcrResultSerializer(result).data)


class DocumentOcrRunView(APIView):
    @extend_schema(request=None, responses=OcrResultSerializer,
                   operation_id="documents_ocr_run_create")
    def post(self, request, pk):
        ctx = _staff_ctx(request)
        document = _document_for(request, ctx, pk)
        _ensure_reviewable(ctx, document)
        if not is_ocr_supported(document):
            raise DomainError(_("القراءة الآلية متاحة لملفات PDF والصور (JPG/PNG/TIFF/WebP) فقط."),
                              code="ocr_unsupported_type", status_code=422)
        existing = OcrResult.objects.filter(document=document).first()
        if existing is not None and existing.status == OcrStatus.REVIEWED:
            raise DomainError(_("حُوّلت هذه القراءة إلى تقرير مختبر. عدّل التقرير نفسه."),
                              code="ocr_already_reviewed", status_code=409)
        audit.record(audit.Action.DOCUMENT_OCR_RUN, request=request, ctx=ctx, target=document)
        result = schedule_ocr(document.pk, user=request.user)
        result.refresh_from_db()
        return Response(OcrResultSerializer(result).data)


def _local_noon(day) -> datetime:
    tz = zoneinfo.ZoneInfo(settings.HAYAT_DISPLAY_TIME_ZONE)
    return datetime.combine(day, time(12, 0), tzinfo=tz)


def _review_summary(extracted: dict, observations: list[dict]) -> dict:
    """How many submitted rows match a machine suggestion exactly (accuracy tracking)."""

    def key(name, value, unit):
        return (str(name or "").strip().lower(), str(value or "").strip(),
                str(unit or "").strip().lower())

    suggested = set()
    for row in extracted.get("rows", []):
        value = row.get("value_numeric", {}).get("value") or row.get("value_text", {}).get("value")
        suggested.add(key(row.get("name", {}).get("value"), value, row.get("unit", {}).get("value")))
    unchanged = 0
    for obs in observations:
        value = obs.get("value_numeric")
        value = (format(Decimal(value).normalize(), "f") if value is not None
                 else obs.get("value_text"))
        if key(obs.get("name"), value, obs.get("unit")) in suggested:
            unchanged += 1
    return {"rows_suggested": len(extracted.get("rows", [])),
            "rows_submitted": len(observations), "rows_unchanged": unchanged}


class DocumentOcrConvertView(APIView):
    @extend_schema(request=OcrConvertSerializer, responses={201: LabReportSerializer},
                   operation_id="documents_ocr_convert_to_lab_report_create")
    def post(self, request, pk):
        ctx = _staff_ctx(request)
        document = _document_for(request, ctx, pk)
        _ensure_reviewable(ctx, document)
        body = OcrConvertSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        v = body.validated_data
        with transaction.atomic():
            result = (OcrResult.objects.select_for_update().filter(document=document).first())
            if result is None:
                # OCR engine unavailable or never run: manual transcription is still allowed.
                result = OcrResult.objects.create(document=document, provider="manual",
                                                  status=OcrStatus.UNAVAILABLE)
            if result.status == OcrStatus.REVIEWED and result.lab_report_id:
                raise DomainError(_("حُوّلت هذه القراءة إلى تقرير مختبر مسبقاً."),
                                  code="ocr_already_reviewed", status_code=409)
            data = {"title": v["title"], "external_lab_name": v.get("external_lab_name", ""),
                    "conclusion": v.get("conclusion", "")}
            day = v.get("result_date") or document.document_date
            if day:
                data["occurred_at"] = _local_noon(day)
            report = records.create(ctx, LabReport, patient=document.patient, data=data,
                                    source=RecordSource.DOCUMENT_IMPORT, request=request)
            observations = [dict(o) for o in v["observations"]]
            LabObservation.objects.bulk_create(
                LabObservation(report=report, **{**obs, "position": i})
                for i, obs in enumerate(observations))
            if document.lab_report_id is None:
                ClinicalDocument.objects.filter(pk=document.pk).update(lab_report=report)
            result.status = OcrStatus.REVIEWED
            result.lab_report = report
            result.reviewed_by = request.user
            result.reviewed_at = timezone.now()
            result.review = _review_summary(result.extracted or {}, observations)
            result.save()
            audit.record(audit.Action.DOCUMENT_OCR_CONVERT, request=request, ctx=ctx,
                         target=document, metadata={"lab_report": str(report.pk),
                                                    **result.review})
        report = LabReport.objects.prefetch_related("observations", "documents").get(pk=report.pk)
        return Response(LabReportSerializer(report, context={"request": request, "ctx": ctx}).data,
                        status=201)
