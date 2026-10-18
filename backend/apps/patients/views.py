from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.access import policy
from apps.access.context import CanManagePatients, HasPracticeContext, require_practice_context
from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.core.arabic import normalize_arabic, normalize_syrian_phone
from apps.core.exceptions import DomainError

from . import services
from .models import CardStatus, HealthCard, Patient
from .serializers import (
    ActivateAccountSerializer,
    DuplicateCheckResponseSerializer,
    DuplicateCheckSerializer,
    GuardianSerializer,
    HealthCardSerializer,
    IdentifySerializer,
    LinkGuardianSerializer,
    PatientCreateSerializer,
    PatientDetailSerializer,
    PatientListSerializer,
    PatientWriteSerializer,
    ReissueCardSerializer,
)

AccessInfoSerializer = inline_serializer("PatientAccessInfo", {
    "registered": serializers.BooleanField(),
    "network_scopes": serializers.ListField(child=serializers.CharField()),
    "can_view_clinical": serializers.BooleanField(),
    "can_author": serializers.BooleanField(),
})

IdentifyResponseSerializer = inline_serializer("IdentifiedPatient", {
    "patient": PatientListSerializer(),
    "access": AccessInfoSerializer,
})


def access_info(ctx, patient_id) -> dict:
    access = policy.clinical_access(ctx, patient_id)
    registered = access.registered if ctx.is_clinician else policy.is_registered(ctx, patient_id)
    return {
        "registered": registered,
        "network_scopes": sorted(access.network_scopes),
        "can_view_clinical": access.any,
        "can_author": ctx.is_clinician and access.any,
    }


class PatientViewSet(viewsets.GenericViewSet):
    """Patient identity for facility staff. Clinical data lives under /clinical/."""
    queryset = Patient.objects.none()  # OpenAPI introspection only

    permission_classes = [HasPracticeContext]
    lookup_value_regex = "[0-9a-f-]{36}"
    throttle_scope = None  # set per action (identify)

    def get_queryset(self):
        return policy.patients_visible_to_staff(require_practice_context(self.request))

    def _get_patient(self, pk) -> Patient:
        ctx = require_practice_context(self.request)
        patient = self.get_queryset().filter(pk=pk).first()
        if patient is None:
            audit.record(audit.Action.ACCESS_DENIED, request=self.request, ctx=ctx,
                         outcome=AuditOutcome.DENIED, target_type="patients.patient",
                         target_id=str(pk))
            raise DomainError(_("المريض غير موجود أو لا تملك صلاحية الوصول إليه."),
                              code="not_found", status_code=404)
        return patient

    @extend_schema(
        parameters=[OpenApiParameter("q", str, description="Name, health number or phone")],
        responses=PatientListSerializer(many=True),
    )
    def list(self, request):
        ctx = require_practice_context(request)
        qs = self.get_queryset()
        q = (request.query_params.get("q") or "").strip()
        if q:
            digits = services.clean_health_number(q)
            has_letters = any(ch.isalpha() for ch in q)
            if digits and len(digits) >= 6 and not has_letters:
                phone = normalize_syrian_phone(q)
                qs = qs.filter(Q(health_number__startswith=digits) | Q(phone=phone)
                               | Q(phone__endswith=digits[-9:]))
            else:
                norm = normalize_arabic(q)
                qs = (qs.annotate(sim=TrigramSimilarity("name_search", norm))
                      .filter(Q(name_search__icontains=norm) | Q(sim__gt=0.2))
                      .order_by("-sim"))
            audit.record(audit.Action.PATIENT_SEARCH, request=request, ctx=ctx)
        else:
            qs = qs.order_by("-registrations__last_visit_at", "-created_at")
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(PatientListSerializer(page, many=True).data)

    @extend_schema(request=PatientCreateSerializer, responses={201: PatientDetailSerializer})
    def create(self, request):
        ctx = require_practice_context(request)
        if not ctx.can_manage_patients:
            raise DomainError(_("لا تملك صلاحية إنشاء ملفات المرضى."), code="forbidden",
                              status_code=403)
        serializer = PatientCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        acknowledged = data.pop("acknowledge_duplicates", False)
        if not acknowledged:
            dupes = services.duplicate_candidates(
                ctx=ctx, first_name=data["first_name"], father_name=data.get("father_name", ""),
                family_name=data.get("family_name", ""),
                birth_year=data["birth_date"].year if data.get("birth_date") else None,
                phone=data.get("phone", ""),
            )
            if dupes["candidates"] or dupes["network_match_hint"]:
                return Response({
                    "code": "possible_duplicate",
                    "message": _("يوجد مرضى بمعلومات مشابهة. تأكد قبل إنشاء ملف جديد."),
                    "candidates": PatientListSerializer(dupes["candidates"], many=True).data,
                    "network_match_hint": dupes["network_match_hint"],
                }, status=status.HTTP_409_CONFLICT)
        patient = services.create_patient(ctx=ctx, data=data, request=request)
        return Response(PatientDetailSerializer(patient).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses=inline_serializer("PatientWithAccess", {
        "patient": PatientDetailSerializer(), "access": AccessInfoSerializer,
    }))
    def retrieve(self, request, pk=None):
        ctx = require_practice_context(request)
        patient = self._get_patient(pk)
        audit.record(audit.Action.PATIENT_VIEW, request=request, ctx=ctx, target=patient,
                     patient_id=patient.pk)
        return Response({"patient": PatientDetailSerializer(patient).data,
                         "access": access_info(ctx, patient.pk)})

    @extend_schema(request=PatientWriteSerializer, responses=PatientDetailSerializer)
    def partial_update(self, request, pk=None):
        ctx = require_practice_context(request)
        if not ctx.can_manage_patients or not policy.is_registered(ctx, pk):
            raise DomainError(_("لا تملك صلاحية تعديل بيانات هذا المريض."), code="forbidden",
                              status_code=403)
        patient = self._get_patient(pk)
        serializer = PatientWriteSerializer(patient, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "phone" in serializer.validated_data:
            serializer.validated_data["phone"] = normalize_syrian_phone(
                serializer.validated_data["phone"])
        serializer.save()
        audit.record(audit.Action.PATIENT_UPDATE, request=request, ctx=ctx, target=patient,
                     metadata={"fields": sorted(serializer.validated_data)})
        return Response(PatientDetailSerializer(patient).data)

    @extend_schema(request=DuplicateCheckSerializer, responses=DuplicateCheckResponseSerializer)
    @action(detail=False, methods=["post"], url_path="check-duplicates",
            permission_classes=[CanManagePatients])
    def check_duplicates(self, request):
        ctx = require_practice_context(request)
        data = DuplicateCheckSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = services.duplicate_candidates(ctx=ctx, **data.validated_data)
        return Response({
            "candidates": PatientListSerializer(result["candidates"], many=True).data,
            "network_match_hint": result["network_match_hint"],
        })

    @extend_schema(request=IdentifySerializer, responses=IdentifyResponseSerializer)
    @action(detail=False, methods=["post"], throttle_classes=[ScopedRateThrottle],
            throttle_scope="card_resolve")
    def identify(self, request):
        """Resolve a presented card QR or health number to a minimal identity."""
        ctx = require_practice_context(request)
        if not (ctx.can_manage_patients or ctx.is_clinician):
            raise DomainError(_("لا تملك صلاحية التعرف على المرضى."), code="forbidden",
                              status_code=403)
        data = IdentifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        patient = services.identify_presented_patient(ctx=ctx, request=request,
                                                      **data.validated_data)
        return Response({"patient": PatientListSerializer(patient).data,
                         "access": access_info(ctx, patient.pk)})

    @extend_schema(request=IdentifySerializer, responses=IdentifyResponseSerializer)
    @action(detail=False, methods=["post"], permission_classes=[CanManagePatients])
    def register(self, request):
        """Register an existing network patient at this facility. Requires the presented card
        or health number as proof of presence."""
        ctx = require_practice_context(request)
        data = IdentifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        patient = services.identify_presented_patient(ctx=ctx, request=request,
                                                      **data.validated_data)
        services.register_patient(ctx=ctx, patient=patient, request=request)
        return Response({"patient": PatientListSerializer(patient).data,
                         "access": access_info(ctx, patient.pk)})

    @extend_schema(responses=HealthCardSerializer)
    @action(detail=True, methods=["get"])
    def card(self, request, pk=None):
        ctx = require_practice_context(request)
        patient = self._get_patient(pk)
        if not policy.is_registered(ctx, patient.pk):
            raise DomainError(_("البطاقة متاحة للمنشآت المسجل فيها المريض."), code="forbidden",
                              status_code=403)
        card = HealthCard.objects.filter(patient=patient, status=CardStatus.ACTIVE).first()
        if card is None:
            card = services.issue_card(patient, issued_by=request.user, request=request, ctx=ctx)
        return Response(HealthCardSerializer(card).data)

    @extend_schema(request=ReissueCardSerializer, responses=HealthCardSerializer)
    @card.mapping.post
    def reissue_card(self, request, pk=None):
        ctx = require_practice_context(request)
        if not ctx.can_manage_patients or not policy.is_registered(ctx, pk):
            raise DomainError(_("لا تملك صلاحية إصدار بطاقة."), code="forbidden", status_code=403)
        patient = self._get_patient(pk)
        data = ReissueCardSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        card = services.issue_card(patient, issued_by=request.user,
                                   reason=data.validated_data["reason"], request=request, ctx=ctx)
        return Response(HealthCardSerializer(card).data, status=status.HTTP_201_CREATED)


    def _require_registered_desk(self, pk):
        ctx = require_practice_context(self.request)
        if not ctx.can_manage_patients or not policy.is_registered(ctx, pk):
            raise DomainError(_("هذه العملية متاحة للمنشأة المسجل فيها المريض."), code="forbidden",
                              status_code=403)
        return ctx

    @extend_schema(request=ActivateAccountSerializer, responses={201: inline_serializer(
        "AccountActivated", {"setup_link": serializers.CharField(allow_blank=True)})})
    @action(detail=True, methods=["post"])
    def account(self, request, pk=None):
        """Give the patient an app account. The setup link is returned only in development."""
        from django.conf import settings as dj_settings

        ctx = self._require_registered_desk(pk)
        patient = self._get_patient(pk)
        data = ActivateAccountSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        _user, link = services.activate_account(ctx=ctx, patient=patient, request=request,
                                                **data.validated_data)
        return Response({"setup_link": link if dj_settings.DEBUG else ""},
                        status=status.HTTP_201_CREATED)

    @extend_schema(request=LinkGuardianSerializer, responses={201: GuardianSerializer})
    @action(detail=True, methods=["post"])
    def guardians(self, request, pk=None):
        ctx = self._require_registered_desk(pk)
        patient = self._get_patient(pk)
        data = LinkGuardianSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        guardianship = services.link_guardian(ctx=ctx, patient=patient, request=request,
                                              **data.validated_data)
        return Response(GuardianSerializer(guardianship).data, status=status.HTTP_201_CREATED)


class PublicCardView(APIView):
    """What an anonymous phone camera sees when scanning a card: nothing personal."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_verify"

    @extend_schema(responses=inline_serializer("PublicCard", {
        "valid": serializers.BooleanField(), "brand": serializers.CharField(),
    }))
    def get(self, request, token: str):
        from django.conf import settings

        valid = HealthCard.objects.filter(token=token, status=CardStatus.ACTIVE).exists()
        return Response({"valid": valid, "brand": settings.HAYAT["BRAND_NAME"]})


def get_patient_for_staff(request, pk) -> Patient:
    ctx = require_practice_context(request)
    return get_object_or_404(policy.patients_visible_to_staff(ctx), pk=pk)
