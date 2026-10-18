from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_field,
    inline_serializer,
)
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.access.context import IsClinician, require_practice_context
from apps.audit import services as audit
from apps.billing import services as billing
from apps.billing.models import AIUsageRecord
from apps.clinical.models import Encounter
from apps.core.exceptions import DomainError

from . import audio, samples, services
from .models import ConsentMethod, ScribeMode, ScribeSession


def samples_enabled() -> bool:
    return settings.DEBUG or getattr(settings, "TESTING", False) or settings.HAYAT.get(
        "AI_SAMPLES_ENABLED", False)


class SessionSerializer(serializers.ModelSerializer):
    audio_available = serializers.SerializerMethodField()
    billing = serializers.SerializerMethodField()

    class Meta:
        model = ScribeSession
        fields = ("id", "encounter", "patient", "mode", "status", "consent_method", "consent_note",
                  "consent_at", "audio_seconds", "audio_is_sample", "audio_available",
                  "retention_until", "transcript", "draft", "is_mock", "stt_provider",
                  "extraction_provider", "attempts", "error_code", "created_at", "ready_at",
                  "approved_at", "applied", "billing")
        read_only_fields = fields

    def get_audio_available(self, obj) -> bool:
        return bool(obj.audio_file) and obj.audio_deleted_at is None

    @extend_schema_field(inline_serializer("ScribeSessionCharge", {
        "billable_seconds": serializers.IntegerField(), "amount": serializers.CharField(),
        "currency": serializers.CharField(), "price_per_minute": serializers.CharField(),
    }, allow_null=True))
    def get_billing(self, obj) -> dict | None:
        """What the doctor was charged for this session (never our internal cost)."""
        usage = AIUsageRecord.objects.filter(session_id=obj.pk, status="charged").first()
        if usage is None:
            return None
        return {"billable_seconds": usage.billable_seconds, "amount": str(usage.billed_amount),
                "currency": usage.currency, "price_per_minute": str(usage.price_per_minute)}


class StartSerializer(serializers.Serializer):
    encounter = serializers.UUIDField()
    mode = serializers.ChoiceField(choices=ScribeMode.choices)
    consent_method = serializers.ChoiceField(choices=ConsentMethod.choices)
    consent_note = serializers.CharField(max_length=300, required=False, allow_blank=True)
    client_key = serializers.CharField(max_length=64)


class ApproveSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=300)
    complaint = serializers.CharField(required=False, allow_blank=True)
    history = serializers.CharField(required=False, allow_blank=True)
    examination = serializers.CharField(required=False, allow_blank=True)
    assessment = serializers.CharField(required=False, allow_blank=True)
    plan = serializers.CharField(required=False, allow_blank=True)
    follow_up_note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    follow_up_date = serializers.DateField(required=False, allow_null=True)
    vitals = serializers.DictField(required=False)
    diagnoses = serializers.ListField(child=serializers.DictField(), required=False)
    allergies = serializers.ListField(child=serializers.DictField(), required=False)
    prescription_items = serializers.ListField(child=serializers.DictField(), required=False)
    orders = serializers.ListField(child=serializers.DictField(), required=False)
    finalize_encounter = serializers.BooleanField(default=False)

    def validate_vitals(self, value):
        from apps.clinical.serializers import VitalsField

        return VitalsField().to_internal_value(value)

    def validate_diagnoses(self, value):
        for d in value:
            if not str(d.get("display", "")).strip():
                raise serializers.ValidationError("كل تشخيص يحتاج نصاً.")
        return value

    def validate_allergies(self, value):
        for a in value:
            if not str(a.get("substance", "")).strip():
                raise serializers.ValidationError("حدد المادة المسببة للحساسية.")
        return value


class ScribeStatusView(APIView):
    permission_classes = [IsClinician]

    @extend_schema(responses=inline_serializer("ScribeStatus", {
        "enabled": serializers.BooleanField(),
        "price_per_minute": serializers.CharField(),
        "currency": serializers.CharField(),
        "samples": serializers.ListField(child=serializers.DictField()),
        "provider_is_mock": serializers.BooleanField(),
    }))
    def get(self, request):
        ctx = require_practice_context(request)
        plan = billing.plan_for(ctx.practitioner)
        return Response({
            "enabled": billing.ai_enabled(ctx.practitioner),
            "price_per_minute": str(plan.price_per_minute), "currency": plan.currency,
            "samples": [{"id": k, "title": v["title"], "mode": v["mode"],
                         "seconds": samples.duration_of(k)} for k, v in samples.SAMPLES.items()]
            if samples_enabled() else [],
            "provider_is_mock": not settings.HAYAT.get("AI_REAL_PROVIDERS_APPROVED"),
        })


class ScribeSessionViewSet(viewsets.GenericViewSet):
    permission_classes = [IsClinician]
    serializer_class = SessionSerializer
    queryset = ScribeSession.objects.none()
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    lookup_value_regex = "[0-9a-f-]{36}"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        ctx = require_practice_context(self.request)
        # Only the author, in the facility they worked in. No admin or colleague access.
        return ScribeSession.objects.filter(author=ctx.user, organization=ctx.organization)

    @extend_schema(parameters=[OpenApiParameter("encounter", str)],
                   responses=SessionSerializer(many=True))
    def list(self, request):
        qs = self.get_queryset()
        if request.query_params.get("encounter"):
            qs = qs.filter(encounter_id=request.query_params["encounter"])
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(SessionSerializer(page, many=True).data)

    def retrieve(self, request, pk=None):
        session = get_object_or_404(self.get_queryset(), pk=pk)
        audit.record("scribe.view", request=request, ctx=require_practice_context(request),
                     target=session)
        return Response(SessionSerializer(session).data)

    @extend_schema(request=StartSerializer, responses={201: SessionSerializer})
    def create(self, request):
        ctx = require_practice_context(request)
        data = StartSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        encounter = Encounter.objects.filter(pk=v["encounter"], author=ctx.user,
                                             organization=ctx.organization).first()
        if encounter is None:
            raise DomainError(_("الزيارة غير موجودة."), code="not_found", status_code=404)
        session = services.start_session(ctx, encounter=encounter, mode=v["mode"],
                                         consent_method=v["consent_method"],
                                         consent_note=v.get("consent_note", ""),
                                         client_key=v["client_key"], request=request)
        return Response(SessionSerializer(session).data, status=status.HTTP_201_CREATED)

    @extend_schema(request={"multipart/form-data": inline_serializer(
        "ScribeAudioUpload", {"file": serializers.FileField()})}, responses=SessionSerializer)
    @action(detail=True, methods=["post", "get", "delete"], url_path="audio")
    def audio(self, request, pk=None):
        ctx = require_practice_context(request)
        session = get_object_or_404(self.get_queryset(), pk=pk)
        if request.method == "GET":
            if not session.audio_file or session.audio_deleted_at:
                raise DomainError(_("التسجيل غير متاح."), code="audio_unavailable",
                                  status_code=404)
            with session.audio_file.open("rb") as fh:
                data = audio.decrypt(fh.read())
            audit.record("scribe.audio_played", request=request, ctx=ctx, target=session)
            response = HttpResponse(data, content_type="audio/wav")
            response["Cache-Control"] = "private, no-store"
            return response
        if request.method == "DELETE":
            services.delete_audio(session, actor=request.user, request=request, reason="doctor")
            session.refresh_from_db()
            return Response(SessionSerializer(session).data)
        upload = request.FILES.get("file")
        if upload is None:
            raise DomainError(_("أرفق ملف التسجيل."), code="file_required")
        session = services.upload_audio(ctx, session, upload.read(), request=request)
        session.refresh_from_db()
        return Response(SessionSerializer(session).data)

    @extend_schema(request=inline_serializer("ScribeSample", {"sample": serializers.CharField()}),
                   responses=SessionSerializer)
    @action(detail=True, methods=["post"])
    def sample(self, request, pk=None):
        """Synthetic test recording (development/testing only)."""
        if not samples_enabled():
            raise DomainError(_("التسجيلات التجريبية غير متاحة في هذه البيئة."),
                              code="samples_disabled", status_code=403)
        ctx = require_practice_context(request)
        session = get_object_or_404(self.get_queryset(), pk=pk)
        services.use_sample(ctx, session, request.data.get("sample", ""), request=request)
        session.refresh_from_db()
        return Response(SessionSerializer(session).data)

    @extend_schema(request=None, responses=SessionSerializer)
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        ctx = require_practice_context(request)
        session = services.retry(ctx, get_object_or_404(self.get_queryset(), pk=pk),
                                 request=request)
        session.refresh_from_db()
        return Response(SessionSerializer(session).data)

    @extend_schema(request=ApproveSerializer, responses=SessionSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        ctx = require_practice_context(request)
        data = ApproveSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        session = services.approve(ctx, get_object_or_404(self.get_queryset(), pk=pk),
                                   data.validated_data, request=request)
        return Response(SessionSerializer(session).data)

    @extend_schema(request=None, responses=SessionSerializer)
    @action(detail=True, methods=["post"])
    def discard(self, request, pk=None):
        ctx = require_practice_context(request)
        session = services.discard(ctx, get_object_or_404(self.get_queryset(), pk=pk),
                                   request=request)
        return Response(SessionSerializer(session).data)

