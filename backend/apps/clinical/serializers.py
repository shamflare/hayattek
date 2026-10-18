from django.db.models import Q
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.core.schema_types import RecordRef, ServiceRequestRef

from .api import RecordMetaSerializer
from .base import RecordStatus
from .models import Allergy, Condition, Encounter

# Plausibility limits only (to catch typos), not clinical thresholds.
VITAL_LIMITS = {
    "bp_systolic": (30, 300),
    "bp_diastolic": (10, 200),
    "heart_rate": (10, 300),
    "temperature_c": (25, 45),
    "resp_rate": (2, 80),
    "spo2": (30, 100),
    "weight_kg": (0.3, 400),
    "height_cm": (20, 260),
    "glucose_mg_dl": (10, 1500),
}


class VitalsField(serializers.JSONField):
    def to_internal_value(self, data):
        data = super().to_internal_value(data) or {}
        if not isinstance(data, dict):
            raise serializers.ValidationError("صيغة العلامات الحيوية غير صحيحة.")
        clean = {}
        for key, value in data.items():
            if key not in VITAL_LIMITS:
                raise serializers.ValidationError(f"علامة حيوية غير معروفة: {key}")
            if value in (None, ""):
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise serializers.ValidationError(f"قيمة غير رقمية: {key}") from None
            low, high = VITAL_LIMITS[key]
            if not low <= number <= high:
                raise serializers.ValidationError(f"قيمة غير منطقية: {key}")
            clean[key] = number
        return clean


class ConditionSerializer(RecordMetaSerializer):
    class Meta:
        model = Condition
        fields = (*RecordMetaSerializer.META_FIELDS, "encounter", "code", "code_system",
                  "display", "category", "clinical_status", "onset_date", "note")
        read_only_fields = fields


class ConditionWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)
    finalize_now = serializers.BooleanField(default=False, write_only=True)

    class Meta:
        model = Condition
        fields = ("patient", "encounter", "code", "display", "category", "clinical_status",
                  "onset_date", "note", "occurred_at", "finalize_now")
        extra_kwargs = {"encounter": {"required": False}}


class AllergySerializer(RecordMetaSerializer):
    class Meta:
        model = Allergy
        fields = (*RecordMetaSerializer.META_FIELDS, "encounter", "substance", "category",
                  "reaction", "severity", "is_active")
        read_only_fields = fields


class AllergyWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)
    finalize_now = serializers.BooleanField(default=False, write_only=True)

    class Meta:
        model = Allergy
        fields = ("patient", "encounter", "substance", "category", "reaction", "severity",
                  "is_active", "finalize_now")
        extra_kwargs = {"encounter": {"required": False}}


class EncounterSerializer(RecordMetaSerializer):
    conditions = serializers.SerializerMethodField()
    prescriptions = serializers.SerializerMethodField()
    service_requests = serializers.SerializerMethodField()
    vitals = serializers.JSONField()

    class Meta:
        model = Encounter
        fields = (*RecordMetaSerializer.META_FIELDS, "encounter_type", "reason", "complaint",
                  "history", "examination", "vitals", "assessment", "plan", "notes",
                  "follow_up_date", "follow_up_note", "conditions", "prescriptions",
                  "service_requests")
        read_only_fields = fields

    def _visible(self, qs):
        """Children follow the parent's visibility; drafts only for their author."""
        ctx = self.context.get("ctx")
        q = ~Q(status=RecordStatus.DRAFT)
        if ctx is not None:
            q |= Q(status=RecordStatus.DRAFT, author=ctx.user)
        return qs.filter(q)

    @extend_schema_field(ConditionSerializer(many=True))
    def get_conditions(self, obj) -> list[dict]:
        qs = self._visible(obj.conditions.all()).select_related("practitioner", "author",
                                                                 "organization")
        return ConditionSerializer(qs, many=True, context=self.context).data

    @extend_schema_field(RecordRef)
    def get_prescriptions(self, obj) -> list[dict]:
        return [{"id": str(p.id), "number": p.number, "status": p.status}
                for p in self._visible(obj.prescriptions.all())]

    @extend_schema_field(ServiceRequestRef)
    def get_service_requests(self, obj) -> list[dict]:
        return [{"id": str(r.id), "number": r.number, "kind": r.kind, "status": r.status,
                 "fulfillment_status": r.fulfillment_status}
                for r in self._visible(obj.service_requests.all())]


class EncounterWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)
    vitals = VitalsField(required=False)

    class Meta:
        model = Encounter
        fields = ("patient", "encounter_type", "occurred_at", "reason", "complaint", "history",
                  "examination", "vitals", "assessment", "plan", "notes", "follow_up_date",
                  "follow_up_note")
