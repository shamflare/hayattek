from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.access import policy
from apps.access.context import resolve_practice_context
from apps.access.models import Scope
from apps.audit import services as audit
from apps.core.exceptions import DomainError
from apps.patients.models import PatientRegistration, PatientReportedInfo

from . import records
from .api import ClinicalRecordViewSet, _parse_uuid
from .base import RecordStatus
from .models import Allergy, Condition, ConditionCategory, Encounter
from .serializers import (
    AllergySerializer,
    AllergyWriteSerializer,
    ConditionSerializer,
    ConditionWriteSerializer,
    EncounterSerializer,
    EncounterWriteSerializer,
)


class EncounterViewSet(ClinicalRecordViewSet):
    model = Encounter
    read_serializer_class = EncounterSerializer
    write_serializer_class = EncounterWriteSerializer
    prefetch_related = ("conditions", "prescriptions", "service_requests")

    def perform_create_record(self, ctx, patient, data):
        record = super().perform_create_record(ctx, patient, data)
        PatientRegistration.objects.filter(patient=patient, organization=ctx.organization
                                           ).update(last_visit_at=timezone.now())
        return record

    @transaction.atomic
    def perform_finalize(self, ctx, record):
        """Finalizing a visit also finalizes the author's draft diagnoses/allergies in it."""
        record = records.finalize(ctx, record, request=self.request)
        for child_model in (Condition, Allergy):
            for child in child_model.objects.filter(encounter=record, author=ctx.user,
                                                    status=RecordStatus.DRAFT):
                records.finalize(ctx, child, request=self.request)
        return record


class _EncounterChildViewSet(ClinicalRecordViewSet):
    def perform_create_record(self, ctx, patient, data):
        finalize_now = data.pop("finalize_now", False)
        encounter = data.get("encounter")
        if encounter is not None and (encounter.patient_id != patient.pk
                                      or encounter.organization_id != ctx.organization.pk
                                      or encounter.author_id != ctx.user.pk):
            raise DomainError(_("الزيارة المحددة لا تخص هذا المريض أو ليست من إنشائك."),
                              code="invalid_encounter")
        record = super().perform_create_record(ctx, patient, data)
        if finalize_now or (encounter is not None and not encounter.is_draft):
            records.finalize(ctx, record, request=self.request)
        return record

    def perform_update_draft(self, ctx, record, data):
        data.pop("finalize_now", None)
        data.pop("encounter", None)
        return super().perform_update_draft(ctx, record, data)

    def perform_amend(self, ctx, record, data, reason):
        data.pop("finalize_now", None)
        data.pop("encounter", None)
        return super().perform_amend(ctx, record, data, reason)


class ConditionViewSet(_EncounterChildViewSet):
    model = Condition
    read_serializer_class = ConditionSerializer
    write_serializer_class = ConditionWriteSerializer

    def filter_list(self, qs):
        category = self.request.query_params.get("category")
        return qs.filter(category=category) if category else qs


class AllergyViewSet(_EncounterChildViewSet):
    model = Allergy
    read_serializer_class = AllergySerializer
    write_serializer_class = AllergyWriteSerializer


# ============================================================ summary & timeline


def _records(request, patient_id, model, *, summary_view=False):
    ctx = resolve_practice_context(request)
    if ctx is not None:
        return policy.visible_records(ctx, patient_id, model, summary_view=summary_view)
    return policy.patient_visible_records(request.user, patient_id, model)


def _require_patient_access(request, patient_id):
    """Either staff with any clinical access, or the patient/guardian."""
    ctx = resolve_practice_context(request)
    if ctx is not None:
        if ctx.is_clinician and policy.clinical_access(ctx, patient_id).any:
            return ctx
        if ctx.is_diagnostic_staff:
            return ctx
    elif policy.user_can_access_patient(request.user, patient_id):
        return None
    raise DomainError(_("المريض غير موجود أو لا تملك صلاحية الوصول إليه."), code="not_found",
                      status_code=404)


def _author(obj) -> str:
    return obj.practitioner.display_name if obj.practitioner_id else obj.author.full_name


def _current_medications(request, patient_id) -> list[dict]:
    """Derived from visible prescriptions whose course has not ended (with source and date)."""
    from apps.medications.models import DurationUnit, Prescription

    today = timezone.localdate()
    rows = []
    prescriptions = (_records(request, patient_id, Prescription, summary_view=True)
                     .filter(status__in=[RecordStatus.FINAL, RecordStatus.AMENDED],
                             occurred_at__gte=timezone.now() - timedelta(days=180))
                     .select_related("practitioner", "author", "organization")
                     .prefetch_related("items").order_by("-occurred_at"))
    for rx in prescriptions:
        start = timezone.localdate(rx.occurred_at)
        for item in rx.items.all():
            end = item.end_date
            if end is None and item.duration_value and item.duration_unit in ("days", "weeks",
                                                                               "months"):
                days = {"days": 1, "weeks": 7, "months": 30}[item.duration_unit]
                end = start + timedelta(days=item.duration_value * days)
            ongoing = item.duration_unit == DurationUnit.ONGOING
            if ongoing or end is None or end >= today:
                rows.append({
                    "name": " ".join(p for p in [item.medication_name, item.strength] if p),
                    "prescription_id": str(rx.pk), "prescribed_at": rx.occurred_at,
                    "prescriber": _author(rx),
                    "organization": rx.organization.name if rx.organization_id else None,
                    "ends_on": end, "ongoing": ongoing or end is None,
                })
    return rows


class PatientSummaryView(APIView):
    """Everything a doctor needs at a glance, in one request (§6)."""

    @extend_schema(parameters=[OpenApiParameter("patient", str, required=True)],
                   responses=inline_serializer("PatientSummary", {
                       "allergies": AllergySerializer(many=True),
                       "chronic_conditions": ConditionSerializer(many=True),
                       "current_medications": serializers.ListField(child=serializers.DictField()),
                       "recent_encounters": serializers.ListField(child=serializers.DictField()),
                       "recent_lab_reports": serializers.ListField(child=serializers.DictField()),
                       "patient_reported": serializers.ListField(child=serializers.DictField()),
                       "hidden_scopes": serializers.ListField(child=serializers.CharField()),
                   }))
    def get(self, request):
        from apps.diagnostics.models import LabReport

        patient_id = _parse_uuid(request.query_params.get("patient"))
        ctx = _require_patient_access(request, patient_id)
        serializer_ctx = {"ctx": ctx, "request": request}

        allergies = (_records(request, patient_id, Allergy)
                     .filter(is_active=True).exclude(status=RecordStatus.ENTERED_IN_ERROR)
                     .select_related("practitioner", "author", "organization"))
        chronic = (_records(request, patient_id, Condition)
                   .filter(category=ConditionCategory.PROBLEM_LIST, clinical_status="active")
                   .exclude(status=RecordStatus.ENTERED_IN_ERROR)
                   .select_related("practitioner", "author", "organization"))
        encounters = (_records(request, patient_id, Encounter)
                      .select_related("practitioner", "author", "organization")
                      .order_by("-occurred_at")[:5])
        labs = (_records(request, patient_id, LabReport)
                .select_related("practitioner", "author", "organization")
                .prefetch_related("observations").order_by("-occurred_at")[:5])

        hidden = []
        if ctx is not None and ctx.is_clinician:
            access = policy.clinical_access(ctx, patient_id)
            hidden = [] if access.registered and not access.network_scopes else [
                s for s in Scope.values if s not in access.network_scopes]

        audit.record(audit.Action.RECORD_VIEW, request=request, ctx=ctx, patient_id=patient_id,
                     target_type="patient.summary", target_id=str(patient_id))
        return Response({
            "allergies": AllergySerializer(allergies, many=True, context=serializer_ctx).data,
            "chronic_conditions": ConditionSerializer(chronic, many=True,
                                                      context=serializer_ctx).data,
            "current_medications": _current_medications(request, patient_id),
            "recent_encounters": [{
                "id": str(e.pk), "occurred_at": e.occurred_at, "reason": e.reason,
                "assessment": e.assessment[:200], "status": e.status, "author_name": _author(e),
                "organization_name": e.organization.name if e.organization_id else None,
            } for e in encounters],
            "recent_lab_reports": [{
                "id": str(r.pk), "occurred_at": r.occurred_at, "title": r.title,
                "status": r.status,
                "abnormal_count": sum(1 for o in r.observations.all()
                                      if o.interpretation and o.interpretation != "normal"),
                "organization_name": r.organization.name if r.organization_id
                else r.external_lab_name,
            } for r in labs],
            "patient_reported": [{"id": str(i.pk), "kind": i.kind, "text": i.text,
                                  "created_at": i.created_at}
                                 for i in PatientReportedInfo.objects.filter(
                                     patient_id=patient_id, is_active=True)],
            "hidden_scopes": hidden,
        })


TIMELINE_TYPES = ("encounter", "prescription", "lab_report", "imaging_report", "document",
                  "service_request", "referral", "condition", "allergy")


def _timeline_sources():
    from apps.diagnostics.models import ImagingReport, LabReport, ServiceRequest
    from apps.documents.models import ClinicalDocument
    from apps.medications.models import Prescription
    from apps.referrals.models import Referral

    return {
        "encounter": (Encounter, lambda r: r.reason or r.get_encounter_type_display()),
        "prescription": (Prescription, lambda r: f"وصفة {r.number}"),
        "lab_report": (LabReport, lambda r: r.title),
        "imaging_report": (ImagingReport, lambda r: r.title),
        "document": (ClinicalDocument, lambda r: r.title),
        "service_request": (ServiceRequest,
                            lambda r: f"طلب {'تحليل' if r.kind == 'lab' else 'تصوير'} {r.number}"),
        "referral": (Referral, lambda r: "إحالة"),
        "condition": (Condition, lambda r: r.display),
        "allergy": (Allergy, lambda r: f"حساسية: {r.substance}"),
    }


class TimelineView(APIView):
    """Chronological cards across record types. Paginate with ?before=<occurred_at>."""

    @extend_schema(
        parameters=[OpenApiParameter("patient", str, required=True),
                    OpenApiParameter("before", str), OpenApiParameter("types", str)],
        responses=inline_serializer("Timeline", {
            "items": serializers.ListField(child=serializers.DictField()),
            "next_before": serializers.DateTimeField(allow_null=True),
        }))
    def get(self, request):
        patient_id = _parse_uuid(request.query_params.get("patient"))
        ctx = _require_patient_access(request, patient_id)
        audit.record(audit.Action.RECORD_VIEW, request=request, ctx=ctx, patient_id=patient_id,
                     target_type="patient.timeline", target_id=str(patient_id))
        before = parse_datetime(request.query_params.get("before") or "")
        wanted = [t for t in (request.query_params.get("types") or "").split(",") if t]
        limit = 20
        items = []
        for key, (model, title) in _timeline_sources().items():
            if wanted and key not in wanted:
                continue
            if key in ("condition", "allergy") and not wanted:
                continue  # shown inside their encounter / summary by default
            qs = _records(request, patient_id, model)
            if before:
                qs = qs.filter(occurred_at__lt=before)
            for record in qs.select_related("practitioner", "author", "organization").order_by(
                    "-occurred_at")[:limit]:
                items.append({
                    "type": key, "id": str(record.pk), "occurred_at": record.occurred_at,
                    "title": title(record), "status": record.status,
                    "author_name": _author(record),
                    "organization_name": record.organization.name if record.organization_id
                    else None,
                    "source": record.source,
                })
        items.sort(key=lambda i: i["occurred_at"], reverse=True)
        page = items[:limit]
        return Response({"items": page,
                         "next_before": page[-1]["occurred_at"] if len(items) > limit else None})
