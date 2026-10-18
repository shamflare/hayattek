"""Patient self-service: profile, card, self-reported info, correction requests."""

from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access import policy
from apps.audit import services as audit
from apps.core.arabic import normalize_syrian_phone
from apps.core.exceptions import DomainError

from . import services
from .models import CardStatus, CorrectionRequest, HealthCard, Patient, PatientReportedInfo
from .serializers import (
    HealthCardSerializer,
    PatientDetailSerializer,
    PatientReportedInfoSerializer,
    PatientSelfUpdateSerializer,
)

CorrectionSerializer = inline_serializer("CorrectionRequestInput", {
    "target_type": serializers.ChoiceField(choices=["encounter", "prescription", "lab_report",
                                                    "imaging_report", "condition", "allergy",
                                                    "document"]),
    "target_id": serializers.UUIDField(),
    "message": serializers.CharField(max_length=1000),
})


class MyPatientViewSet(viewsets.GenericViewSet):
    """Endpoints under /me/patients/{patient_id}/ for the patient or a guardian."""
    queryset = Patient.objects.none()  # OpenAPI introspection only

    lookup_value_regex = "[0-9a-f-]{36}"

    def _patient(self, pk, *, manage=False) -> Patient:
        if not policy.user_can_access_patient(self.request.user, pk, manage_sharing=manage):
            raise DomainError(_("الملف غير موجود."), code="not_found", status_code=404)
        return get_object_or_404(Patient, pk=pk)

    @extend_schema(responses=PatientDetailSerializer)
    def retrieve(self, request, pk=None):
        return Response(PatientDetailSerializer(self._patient(pk)).data)

    @extend_schema(request=PatientSelfUpdateSerializer, responses=PatientDetailSerializer)
    def partial_update(self, request, pk=None):
        patient = self._patient(pk, manage=True)
        serializer = PatientSelfUpdateSerializer(patient, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field in ("phone", "emergency_contact_phone"):
            if field in serializer.validated_data:
                serializer.validated_data[field] = normalize_syrian_phone(
                    serializer.validated_data[field])
        serializer.save()
        audit.record(audit.Action.PATIENT_UPDATE, request=request, target=patient,
                     metadata={"fields": sorted(serializer.validated_data), "by": "patient"})
        return Response(PatientDetailSerializer(patient).data)

    @extend_schema(responses=HealthCardSerializer)
    @action(detail=True, methods=["get"])
    def card(self, request, pk=None):
        patient = self._patient(pk)
        card = HealthCard.objects.filter(patient=patient, status=CardStatus.ACTIVE).first()
        if card is None:
            card = services.issue_card(patient, issued_by=request.user, request=request)
        return Response(HealthCardSerializer(card).data)

    @extend_schema(request=inline_serializer("ReportCardLost", {
        "reason": serializers.CharField(max_length=200)}), responses=HealthCardSerializer)
    @action(detail=True, methods=["post"], url_path="card/replace")
    def replace_card(self, request, pk=None):
        """Lost or leaked card: revoke immediately and issue a new QR (number unchanged)."""
        patient = self._patient(pk, manage=True)
        card = services.issue_card(patient, issued_by=request.user,
                                   reason=request.data.get("reason", "lost"), request=request)
        return Response(HealthCardSerializer(card).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses=PatientReportedInfoSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="reported")
    def reported(self, request, pk=None):
        patient = self._patient(pk)
        return Response(PatientReportedInfoSerializer(
            PatientReportedInfo.objects.filter(patient=patient, is_active=True), many=True).data)

    @extend_schema(request=PatientReportedInfoSerializer,
                   responses={201: PatientReportedInfoSerializer})
    @reported.mapping.post
    def add_reported(self, request, pk=None):
        patient = self._patient(pk, manage=True)
        serializer = PatientReportedInfoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(patient=patient, reported_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(parameters=[OpenApiParameter("item", str, required=True)], request=None,
                   responses={204: None})
    @action(detail=True, methods=["post"], url_path="reported/remove")
    def remove_reported(self, request, pk=None):
        patient = self._patient(pk, manage=True)
        PatientReportedInfo.objects.filter(patient=patient,
                                           pk=request.query_params.get("item")).update(
            is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=CorrectionSerializer, responses={201: inline_serializer(
        "CorrectionCreated", {"id": serializers.UUIDField()})})
    @action(detail=True, methods=["post"], url_path="corrections")
    def request_correction(self, request, pk=None):
        """Patients cannot edit clinical records; they ask the author to correct them."""
        from apps.clinical.models import Allergy, Condition, Encounter
        from apps.diagnostics.models import ImagingReport, LabReport
        from apps.documents.models import ClinicalDocument
        from apps.medications.models import Prescription
        from apps.notifications.models import NotificationKind
        from apps.notifications.services import notify

        patient = self._patient(pk, manage=True)
        models = {"encounter": Encounter, "prescription": Prescription, "lab_report": LabReport,
                  "imaging_report": ImagingReport, "condition": Condition, "allergy": Allergy,
                  "document": ClinicalDocument}
        target_type = request.data.get("target_type")
        message = (request.data.get("message") or "").strip()
        if target_type not in models or len(message) < 5:
            raise DomainError(_("حدد السجل واكتب ملاحظتك."), code="invalid")
        record = policy.patient_visible_records(request.user, patient.pk, models[target_type]
                                                ).filter(pk=request.data.get("target_id")).first()
        if record is None:
            raise DomainError(_("السجل غير موجود."), code="not_found", status_code=404)
        correction = CorrectionRequest.objects.create(
            patient=patient, target_type=target_type, target_id=record.pk,
            organization=record.organization, message=message[:1000], requested_by=request.user)
        notify([record.author], kind=NotificationKind.SYSTEM, title=_("طلب تصحيح من مريض"),
               link=f"/app/patients/{patient.pk}")
        return Response({"id": str(correction.pk)}, status=status.HTTP_201_CREATED)
