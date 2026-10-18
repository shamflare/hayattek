from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema, extend_schema_field, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access.context import require_practice_context
from apps.access.models import GrantMethod, Purpose
from apps.access.services import create_grant
from apps.audit import services as audit
from apps.clinical import records
from apps.clinical.api import ClinicalRecordViewSet, RecordMetaSerializer
from apps.clinical.base import VISIBLE_STATUSES
from apps.core.exceptions import DomainError
from apps.core.schema_types import PatientBrief
from apps.notifications.models import NotificationKind
from apps.notifications.services import notify
from apps.organizations.models import Membership, Role

from .models import Referral, ReferralState

REFERRAL_GRANT_DAYS = 30


class ReferralSerializer(RecordMetaSerializer):
    target_organization_name = serializers.CharField(source="target_organization.name",
                                                     read_only=True, default=None)
    target_practitioner_name = serializers.CharField(source="target_practitioner.display_name",
                                                     read_only=True, default=None)
    patient_brief = serializers.SerializerMethodField()

    class Meta:
        model = Referral
        fields = (*RecordMetaSerializer.META_FIELDS, "encounter", "target_organization",
                  "target_organization_name", "target_practitioner", "target_practitioner_name",
                  "target_specialty", "reason", "priority", "shared_scopes",
                  "patient_consented", "state", "response_note", "responded_at",
                  "patient_brief")
        read_only_fields = fields

    @extend_schema_field(PatientBrief)
    def get_patient_brief(self, obj) -> dict:
        return {"full_name": obj.patient.full_name, "age_years": obj.patient.age_years,
                "health_number": obj.patient.formatted_health_number}


class ReferralWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)

    class Meta:
        model = Referral
        fields = ("patient", "encounter", "target_organization", "target_practitioner",
                  "target_specialty", "reason", "priority", "shared_scopes",
                  "patient_consented")
        extra_kwargs = {"encounter": {"required": False}}

    def validate(self, attrs):
        if not (attrs.get("target_organization") or attrs.get("target_practitioner")
                or attrs.get("target_specialty")):
            raise serializers.ValidationError("حدد الطبيب أو الجهة أو الاختصاص المحال إليه.")
        if attrs.get("shared_scopes") and not attrs.get("patient_consented"):
            raise serializers.ValidationError(
                {"patient_consented": "مشاركة المعلومات تتطلب موافقة المريض."})
        return attrs


ResponseSerializer = inline_serializer("ReferralResponse", {
    "accept": serializers.BooleanField(),
    "note": serializers.CharField(required=False, allow_blank=True),
})


class ReferralViewSet(ClinicalRecordViewSet):
    model = Referral
    read_serializer_class = ReferralSerializer
    write_serializer_class = ReferralWriteSerializer
    select_related = ("organization", "author", "practitioner", "patient",
                      "target_organization", "target_practitioner")

    def perform_create_record(self, ctx, patient, data):
        target_practitioner = data.get("target_practitioner")
        if target_practitioner and not data.get("target_organization"):
            membership = Membership.objects.filter(
                user=target_practitioner.user, status="active", roles__contains=[Role.PHYSICIAN]
            ).select_related("organization").first()
            data["target_organization"] = membership.organization if membership else None
        record = records.create(ctx, Referral, patient=patient, data=data, request=self.request)
        return record

    def perform_finalize(self, ctx, record):
        """Sending = finalizing. The target is notified; data is shared only on acceptance."""
        record = records.finalize(ctx, record, request=self.request)
        recipients = []
        if record.target_practitioner_id:
            recipients.append(record.target_practitioner.user)
        elif record.target_organization_id:
            recipients = [m.user for m in Membership.objects.filter(
                organization=record.target_organization, status="active",
                roles__contains=[Role.PHYSICIAN]).select_related("user")]
        notify(recipients, kind=NotificationKind.REFERRAL, title=_("إحالة جديدة"),
               body=_("إحالة من %(org)s") % {"org": ctx.organization.name},
               link=f"/app/referrals/{record.pk}")
        return record

    @extend_schema(responses=ReferralSerializer(many=True))
    @action(detail=False, methods=["get"])
    def inbox(self, request):
        """Referrals addressed to me or to my organization."""
        ctx = require_practice_context(request)
        if not ctx.is_clinician:
            raise DomainError(_("متاح للأطباء فقط."), code="forbidden", status_code=403)
        qs = (Referral.objects.filter(status__in=VISIBLE_STATUSES)
              .filter(Q(target_practitioner=ctx.practitioner)
                      | Q(target_practitioner__isnull=True,
                          target_organization=ctx.organization))
              .select_related(*self.select_related).order_by("-occurred_at"))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(
            ReferralSerializer(page, many=True, context=self.get_serializer_context()).data)

    @extend_schema(responses=ReferralSerializer(many=True))
    @action(detail=False, methods=["get"])
    def sent(self, request):
        ctx = require_practice_context(request)
        qs = (Referral.objects.filter(author=ctx.user, organization=ctx.organization)
              .select_related(*self.select_related).order_by("-occurred_at"))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(
            ReferralSerializer(page, many=True, context=self.get_serializer_context()).data)

    @extend_schema(request=ResponseSerializer, responses=ReferralSerializer)
    @action(detail=True, methods=["post"])
    def respond(self, request, pk=None):
        ctx = require_practice_context(request)
        with transaction.atomic():
            referral = Referral.objects.select_for_update().select_related(
                "patient", "target_practitioner").filter(
                pk=pk, status__in=VISIBLE_STATUSES).first()
            is_target = referral is not None and ctx.is_clinician and (
                referral.target_practitioner_id == getattr(ctx.practitioner, "pk", None)
                or (referral.target_practitioner_id is None
                    and referral.target_organization_id == ctx.organization.pk))
            if not is_target:
                raise DomainError(_("الإحالة غير موجودة."), code="not_found", status_code=404)
            if referral.state != ReferralState.SENT:
                raise DomainError(_("تم الرد على هذه الإحالة مسبقاً."), code="already_answered")
            accept = bool(request.data.get("accept"))
            referral.state = ReferralState.ACCEPTED if accept else ReferralState.DECLINED
            referral.response_note = (request.data.get("note") or "")[:2000]
            referral.responded_at = timezone.now()
            referral.save(update_fields=["state", "response_note", "responded_at", "updated_at"])
            if accept and referral.patient_consented and referral.shared_scopes:
                create_grant(patient=referral.patient, organization=ctx.organization,
                             practitioner=ctx.practitioner, scopes=referral.shared_scopes,
                             method=GrantMethod.REFERRAL, purpose=Purpose.REFERRAL,
                             duration=timedelta(days=REFERRAL_GRANT_DAYS),
                             granted_by=referral.author,
                             attestation=f"referral:{referral.pk}", request=request, ctx=ctx)
            audit.record(audit.Action.RECORD_UPDATE_DRAFT, request=request, ctx=ctx,
                         target=referral, metadata={"referral_state": referral.state})
        notify([referral.author], kind=NotificationKind.REFERRAL,
               title=_("تم قبول الإحالة") if accept else _("تم الاعتذار عن الإحالة"),
               link=f"/app/patients/{referral.patient_id}")
        return Response(ReferralSerializer(referral, context=self.get_serializer_context()).data)
