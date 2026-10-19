from django.conf import settings
from django.contrib.postgres.search import TrigramSimilarity
from django.db import transaction
from django.db.models import F, Q
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.access.context import IsClinician, require_practice_context
from apps.audit import services as audit
from apps.clinical.api import ClinicalRecordViewSet
from apps.clinical.base import RecordStatus
from apps.core.arabic import normalize_arabic
from apps.core.exceptions import DomainError

from . import services
from .models import (
    CatalogSource,
    Medication,
    MedicationFavorite,
    Prescription,
    PrescriptionTemplate,
    ReviewStatus,
)
from .serializers import (
    FavoriteSerializer,
    MedicationSerializer,
    PrescriptionItemSerializer,
    PrescriptionSerializer,
    PrescriptionWriteSerializer,
    ReorderSerializer,
    TemplateSerializer,
)
from .sig import render_sig


class MedicationViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Catalog search. Clinicians may add an entry missing from the catalog."""

    permission_classes = [IsClinician]
    serializer_class = MedicationSerializer

    @extend_schema(parameters=[OpenApiParameter("q", str)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        practitioner = require_practice_context(self.request).practitioner
        qs = Medication.objects.filter(Medication.visible_to(practitioner), is_active=True)
        if not settings.HAYAT.get("CATALOG_INCLUDE_SYNTHETIC", True):
            qs = qs.filter(is_synthetic=False)  # production: never offer test medicines
        q = normalize_arabic(self.request.query_params.get("q", ""))
        if q:
            qs = (qs.annotate(sim=TrigramSimilarity("search_text", q))
                  .filter(Q(search_text__icontains=q) | Q(sim__gt=0.25))
                  .order_by("-sim", "name"))
        return qs

    def perform_create(self, serializer):
        ctx = require_practice_context(self.request)
        # "Unknown medication": usable at once by its author only; other practitioners see it
        # only if the platform administrator publishes it from the review queue (§11).
        from .catalog import normalize_strength

        serializer.save(source=CatalogSource.PRACTITIONER, review_status=ReviewStatus.PENDING,
                        added_by_practitioner=ctx.practitioner,
                        strength=normalize_strength(serializer.validated_data.get("strength")))


class FavoriteViewSet(viewsets.ModelViewSet):
    queryset = MedicationFavorite.objects.none()  # OpenAPI introspection only
    permission_classes = [IsClinician]
    serializer_class = FavoriteSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return MedicationFavorite.objects.filter(
            practitioner=require_practice_context(self.request).practitioner
        ).select_related("medication")

    def perform_create(self, serializer):
        practitioner = require_practice_context(self.request).practitioner
        medication = serializer.validated_data["medication"]
        if not medication.usable_by(practitioner):
            raise DomainError(_("الدواء غير متاح."), code="not_found", status_code=404)
        if MedicationFavorite.objects.filter(practitioner=practitioner,
                                             medication=medication).exists():
            raise DomainError(_("الدواء موجود في المفضلة."), code="duplicate", status_code=409)
        last = self.get_queryset().order_by("-position").first()
        serializer.save(practitioner=practitioner, position=(last.position + 1) if last else 0)

    @extend_schema(request=ReorderSerializer, responses=FavoriteSerializer(many=True))
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        data = ReorderSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        favorites = {f.pk: f for f in self.get_queryset()}
        with transaction.atomic():
            for position, fav_id in enumerate(data.validated_data["ids"]):
                if fav_id in favorites:
                    MedicationFavorite.objects.filter(pk=fav_id).update(position=position)
        return Response(FavoriteSerializer(self.get_queryset(), many=True).data)


class TemplateViewSet(viewsets.ModelViewSet):
    queryset = PrescriptionTemplate.objects.none()  # OpenAPI introspection only
    permission_classes = [IsClinician]
    serializer_class = TemplateSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return PrescriptionTemplate.objects.filter(
            practitioner=require_practice_context(self.request).practitioner)

    def perform_create(self, serializer):
        serializer.save(practitioner=require_practice_context(self.request).practitioner)


class PrescriptionViewSet(ClinicalRecordViewSet):
    model = Prescription
    read_serializer_class = PrescriptionSerializer
    write_serializer_class = PrescriptionWriteSerializer
    select_related = ("organization", "author", "practitioner", "patient")
    prefetch_related = ("items",)

    def perform_create_record(self, ctx, patient, data):
        return services.create_prescription(ctx, patient=patient, data=data, request=self.request)

    def perform_update_draft(self, ctx, record, data):
        return services.update_draft_prescription(ctx, record, data, request=self.request)

    def perform_amend(self, ctx, record, data, reason):
        return services.amend_prescription(ctx, record, data, reason, request=self.request)

    @action(detail=True, methods=["get"], url_path="print")
    def print_data(self, request, pk=None):
        """Data for the A4 print page (ADR-009). Only finalized prescriptions print."""
        record = self.get_record(pk)
        if record.status not in (RecordStatus.FINAL, RecordStatus.AMENDED):
            raise DomainError(_("اعتمد الوصفة قبل طباعتها."), code="not_final", status_code=409)
        Prescription.objects.filter(pk=record.pk).update(print_count=F("print_count") + 1)
        audit.record(audit.Action.RECORD_PRINT, request=request, ctx=self.ctx, target=record)
        org = record.organization
        practitioner = record.practitioner
        patient = record.patient
        base = settings.HAYAT["PUBLIC_BASE_URL"]
        return Response({
            "brand": settings.HAYAT["BRAND_NAME"],
            "organization": {
                "id": str(org.pk), "name": org.name, "name_en": org.name_en,
                "address": org.address, "city": org.city, "phone": org.phone,
                "print_footer": org.print_footer, "has_logo": bool(org.logo),
            } if org else None,
            "practitioner": {
                "display_name": practitioner.display_name,
                "display_name_en": practitioner.display_name_en,
                "specialty": practitioner.get_specialty_display(),
                "specialty_detail": practitioner.specialty_detail,
                "license_number": practitioner.license_number,
            } if practitioner else {"display_name": record.author.full_name},
            "patient": {
                "full_name": patient.full_name, "age_years": patient.age_years,
                "sex": patient.sex, "health_number": patient.formatted_health_number,
            },
            "prescription": {
                "id": str(record.pk), "number": record.number, "occurred_at": record.occurred_at,
                "diagnosis_text": record.diagnosis_text, "notes": record.notes,
                "status": record.status, "version": record.version,
                "items": PrescriptionItemSerializer(record.items.all(), many=True).data,
            },
            "verification": {
                "code": record.verification_code,
                "url": f"{base}/verify/{record.verification_code}",
            },
        })


class PublicPrescriptionVerifyView(APIView):
    """Authenticity check from the printed QR. Reveals no medicines, diagnosis or patient."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_verify"

    @extend_schema(responses=inline_serializer("PrescriptionVerification", {
        "valid": serializers.BooleanField(),
        "number": serializers.CharField(allow_null=True),
        "issued_on": serializers.DateField(allow_null=True),
        "status": serializers.CharField(allow_null=True),
        "organization_name": serializers.CharField(allow_null=True),
        "practitioner_name": serializers.CharField(allow_null=True),
    }))
    def get(self, request, code: str):
        rx = (Prescription.objects.select_related("organization", "practitioner")
              .filter(verification_code=code.upper().strip())
              .exclude(status=RecordStatus.DRAFT).first())
        if rx is None:
            return Response({"valid": False, "number": None, "issued_on": None, "status": None,
                             "organization_name": None, "practitioner_name": None},
                            status=status.HTTP_404_NOT_FOUND)
        from django.utils import timezone

        return Response({
            "valid": rx.status != RecordStatus.ENTERED_IN_ERROR,
            "number": rx.number,
            "issued_on": timezone.localtime(rx.occurred_at).date(),
            "status": rx.status,
            "organization_name": rx.organization.name if rx.organization_id else None,
            "practitioner_name": rx.practitioner.display_name if rx.practitioner_id else None,
        })


class SigPreviewView(APIView):
    """Render instructions for an unsaved item (live preview in the prescription editor)."""

    permission_classes = [IsClinician]

    @extend_schema(request=PrescriptionItemSerializer,
                   responses=inline_serializer("SigPreview", {"sig": serializers.CharField()}))
    def post(self, request):
        data = PrescriptionItemSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        from .models import PrescriptionItem

        values = dict(data.validated_data)
        values.pop("medication", None)
        return Response({"sig": render_sig(PrescriptionItem(**values))})
