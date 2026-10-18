from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access.context import HasPracticeContext, require_practice_context
from apps.audit import services as audit
from apps.clinical import records
from apps.clinical.api import ClinicalRecordViewSet
from apps.clinical.base import VISIBLE_STATUSES, RecordSource, RecordStatus
from apps.core.exceptions import DomainError
from apps.core.ids import random_code
from apps.notifications.models import NotificationKind
from apps.notifications.services import notify, patient_recipients
from apps.organizations.models import Membership, Role

from .models import (
    FulfillmentStatus,
    ImagingReport,
    LabObservation,
    LabReport,
    LabTestType,
    RequestKind,
    ServiceRequest,
    ServiceRequestItem,
)
from .serializers import (
    FulfillmentSerializer,
    ImagingReportSerializer,
    ImagingReportWriteSerializer,
    LabReportSerializer,
    LabReportWriteSerializer,
    LabTestTypeSerializer,
    ServiceRequestSerializer,
    ServiceRequestWriteSerializer,
)


class LabTestTypeViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [HasPracticeContext]
    serializer_class = LabTestTypeSerializer
    pagination_class = None

    @extend_schema(parameters=[OpenApiParameter("q", str)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = LabTestType.objects.filter(is_active=True)
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(name_ar__icontains=q) | qs.filter(name_en__icontains=q) | qs.filter(
                code__icontains=q)
        return qs[:200]


def _staff_of(organization, role):
    return [m.user for m in Membership.objects.filter(
        organization=organization, status="active", roles__contains=[role]).select_related("user")]


class ServiceRequestViewSet(ClinicalRecordViewSet):
    model = ServiceRequest
    read_serializer_class = ServiceRequestSerializer
    write_serializer_class = ServiceRequestWriteSerializer
    select_related = ("organization", "author", "practitioner", "patient",
                      "performer_organization")
    prefetch_related = ("items", "items__lab_test")

    def filter_list(self, qs):
        kind = self.request.query_params.get("kind")
        return qs.filter(kind=kind) if kind else qs

    @transaction.atomic
    def perform_create_record(self, ctx, patient, data):
        items = data.pop("items")
        send_now = data.pop("send_now", True)
        encounter = data.get("encounter")
        if encounter is not None and (encounter.patient_id != patient.pk
                                      or encounter.organization_id != ctx.organization.pk):
            raise DomainError(_("الزيارة لا تخص هذا المريض."), code="invalid_encounter")
        for _attempt in range(5):
            try:
                with transaction.atomic():
                    prefix = "LB" if data["kind"] == RequestKind.LAB else "IM"
                    record = records.create(
                        ctx, ServiceRequest, patient=patient,
                        data={**data, "number": f"{prefix}-{timezone.now():%y%m}-{random_code(6)}"},
                        request=self.request)
                break
            except IntegrityError:
                continue
        else:
            raise DomainError(_("تعذر إنشاء رقم الطلب."), code="number_collision")
        ServiceRequestItem.objects.bulk_create(
            ServiceRequestItem(request=record, **item) for item in items)
        if send_now:
            self.perform_finalize(ctx, record)
        return record

    def perform_update_draft(self, ctx, record, data):
        items = data.pop("items", None)
        data.pop("send_now", None)
        records.update_draft(ctx, record, data, request=self.request)
        if items is not None:
            record.items.all().delete()
            ServiceRequestItem.objects.bulk_create(
                ServiceRequestItem(request=record, **item) for item in items)
        return record

    def perform_finalize(self, ctx, record):
        record = records.finalize(ctx, record, request=self.request)
        if record.performer_organization_id:
            role = Role.LAB_STAFF if record.kind == RequestKind.LAB else Role.IMAGING_STAFF
            notify(_staff_of(record.performer_organization, role),
                   kind=NotificationKind.INCOMING_ORDER, title=_("طلب جديد وارد"),
                   body=_("طلب رقم %(n)s من %(org)s") % {"n": record.number,
                                                         "org": ctx.organization.name},
                   link=f"/app/lab/requests/{record.pk}")
        return record

    @extend_schema(parameters=[OpenApiParameter("fulfillment_status", str)],
                   responses=ServiceRequestSerializer(many=True))
    @action(detail=False, methods=["get"])
    def incoming(self, request):
        """Inbox for a laboratory or imaging center."""
        ctx = require_practice_context(request)
        if not ctx.is_diagnostic_staff:
            raise DomainError(_("هذه القائمة لطاقم المختبر أو التصوير."), code="forbidden",
                              status_code=403)
        kinds = []
        if ctx.has_role(Role.LAB_STAFF):
            kinds.append(RequestKind.LAB)
        if ctx.has_role(Role.IMAGING_STAFF):
            kinds.append(RequestKind.IMAGING)
        qs = (ServiceRequest.objects.filter(performer_organization=ctx.organization,
                                            status__in=VISIBLE_STATUSES, kind__in=kinds)
              .select_related(*self.select_related).prefetch_related(*self.prefetch_related)
              .order_by("-priority", "-occurred_at"))
        status_filter = request.query_params.get("fulfillment_status")
        if status_filter:
            qs = qs.filter(fulfillment_status__in=status_filter.split(","))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(
            ServiceRequestSerializer(page, many=True, context=self.get_serializer_context()).data)

    @extend_schema(request=FulfillmentSerializer, responses=ServiceRequestSerializer)
    @action(detail=True, methods=["post"])
    def fulfillment(self, request, pk=None):
        ctx = require_practice_context(request)
        record = self.get_record(pk)
        data = FulfillmentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        new_status = data.validated_data["fulfillment_status"]
        is_performer = record.performer_organization_id == ctx.organization.pk
        is_orderer = record.author_id == ctx.user.pk and new_status == "cancelled"
        if not (is_performer and ctx.is_diagnostic_staff) and not is_orderer:
            raise DomainError(_("لا تملك صلاحية تحديث حالة الطلب."), code="forbidden",
                              status_code=403)
        record.fulfillment_status = new_status
        record.save(update_fields=["fulfillment_status", "updated_at"])
        audit.record(audit.Action.RECORD_UPDATE_DRAFT, request=request, ctx=ctx, target=record,
                     metadata={"fulfillment_status": new_status})
        return Response(ServiceRequestSerializer(record, context=self.get_serializer_context()
                                                 ).data)


class _ResultViewSet(ClinicalRecordViewSet):
    """Shared by lab and imaging reports."""

    diagnostic_role = ""

    def allow_diagnostic_authors(self, ctx) -> bool:
        return ctx.has_role(self.diagnostic_role)

    def source_for(self, ctx) -> str:
        if ctx.has_role(self.diagnostic_role) and not ctx.is_clinician:
            return RecordSource.LABORATORY if self.model is LabReport else RecordSource.IMAGING
        return RecordSource.DOCUMENT_IMPORT

    def check_service_request(self, ctx, patient, service_request):
        if service_request is None:
            return
        if service_request.patient_id != patient.pk or not (
                service_request.performer_organization_id == ctx.organization.pk
                or service_request.organization_id == ctx.organization.pk):
            raise DomainError(_("الطلب المرتبط لا يخص هذا المريض أو هذه الجهة."),
                              code="invalid_request")

    def perform_finalize(self, ctx, record):
        record = records.finalize(ctx, record, request=self.request)
        request_obj = record.service_request
        if request_obj is not None:
            ServiceRequest.objects.filter(pk=request_obj.pk).update(
                fulfillment_status=FulfillmentStatus.COMPLETED)
            notify([request_obj.author], kind=NotificationKind.LAB_RESULT,
                   title=_("صدرت نتيجة طلب"), body=_("الطلب %(n)s") % {"n": request_obj.number},
                   link=f"/app/patients/{record.patient_id}")
        notify(patient_recipients(record.patient), kind=NotificationKind.LAB_RESULT,
               title=_("نتيجة جديدة في ملفك"), body=_("أُضيفت نتيجة جديدة إلى ملفك الطبي."),
               link="/app/me/labs")
        return record


class LabReportViewSet(_ResultViewSet):
    model = LabReport
    read_serializer_class = LabReportSerializer
    write_serializer_class = LabReportWriteSerializer
    diagnostic_role = Role.LAB_STAFF
    prefetch_related = ("observations", "documents")

    @transaction.atomic
    def perform_create_record(self, ctx, patient, data):
        observations = data.pop("observations", [])
        self.check_service_request(ctx, patient, data.get("service_request"))
        record = records.create(ctx, LabReport, patient=patient, data=data,
                                source=self.source_for(ctx), request=self.request)
        self._write_observations(record, observations)
        if record.service_request_id:
            ServiceRequest.objects.filter(pk=record.service_request_id,
                                          fulfillment_status__in=["requested", "received"]
                                          ).update(fulfillment_status="in_progress")
        return record

    def _write_observations(self, record, observations):
        record.observations.all().delete()
        LabObservation.objects.bulk_create(
            LabObservation(report=record, **{**obs, "position": i})
            for i, obs in enumerate(observations))

    @transaction.atomic
    def perform_update_draft(self, ctx, record, data):
        observations = data.pop("observations", None)
        data.pop("service_request", None)
        records.update_draft(ctx, record, data, request=self.request)
        if observations is not None:
            self._write_observations(record, observations)
        return record

    @transaction.atomic
    def perform_amend(self, ctx, record, data, reason):
        from .serializers import LabObservationSerializer

        observations = data.pop("observations", None)
        data.pop("service_request", None)
        old = LabObservationSerializer(record.observations.all(), many=True).data
        record = records.amend(ctx, record, data, reason, request=self.request,
                               children={"observations": old})
        if observations is not None:
            self._write_observations(record, observations)
        return record

    @extend_schema(parameters=[OpenApiParameter("patient", str, required=True),
                               OpenApiParameter("test", str, required=True)])
    @action(detail=False, methods=["get"])
    def trend(self, request):
        """One test over time. Series are split by unit: values with different units are
        never plotted on the same axis (§10)."""
        from apps.clinical.api import _parse_uuid

        patient_id = _parse_uuid(request.query_params.get("patient"))
        test_id = _parse_uuid(request.query_params.get("test"))
        reports = (self.records_for_patient(patient_id)
                   .filter(status__in=[RecordStatus.FINAL, RecordStatus.AMENDED]))
        observations = (LabObservation.objects.filter(report__in=reports, test_id=test_id,
                                                      value_numeric__isnull=False)
                        .select_related("report", "report__organization")
                        .order_by("report__occurred_at"))
        series: dict[str, list] = {}
        for obs in observations:
            series.setdefault(obs.unit or "-", []).append({
                "occurred_at": obs.report.occurred_at, "value": obs.value_numeric,
                "reference_low": obs.reference_low, "reference_high": obs.reference_high,
                "interpretation": obs.interpretation, "report_id": str(obs.report_id),
                "lab": obs.report.organization.name if obs.report.organization_id
                else obs.report.external_lab_name,
            })
        return Response({"series": [{"unit": u, "points": p} for u, p in series.items()]})


class ImagingReportViewSet(_ResultViewSet):
    model = ImagingReport
    read_serializer_class = ImagingReportSerializer
    write_serializer_class = ImagingReportWriteSerializer
    diagnostic_role = Role.IMAGING_STAFF
    prefetch_related = ("documents",)

    def perform_create_record(self, ctx, patient, data):
        self.check_service_request(ctx, patient, data.get("service_request"))
        return records.create(ctx, ImagingReport, patient=patient, data=data,
                              source=self.source_for(ctx), request=self.request)

    def perform_update_draft(self, ctx, record, data):
        data.pop("service_request", None)
        return records.update_draft(ctx, record, data, request=self.request)
