from rest_framework import serializers

from apps.clinical.api import RecordMetaSerializer

from .models import (
    Medication,
    MedicationFavorite,
    Prescription,
    PrescriptionItem,
    PrescriptionTemplate,
    ScheduleType,
)
from .sig import render_sig


class MedicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Medication
        fields = ("id", "name", "brand_name", "active_ingredient", "strength", "dosage_form",
                  "unit", "default_route", "is_active", "source", "manufacturer",
                  "is_synthetic")
        read_only_fields = ("is_active", "source", "is_synthetic")


class FavoriteSerializer(serializers.ModelSerializer):
    medication = MedicationSerializer(read_only=True)
    medication_id = serializers.PrimaryKeyRelatedField(
        source="medication", queryset=Medication.objects.filter(is_active=True), write_only=True)

    class Meta:
        model = MedicationFavorite
        fields = ("id", "medication", "medication_id", "position", "preset", "use_count")
        read_only_fields = ("use_count",)


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField())


class PrescriptionItemSerializer(serializers.ModelSerializer):
    sig = serializers.SerializerMethodField()

    class Meta:
        model = PrescriptionItem
        fields = ("id", "position", "medication", "medication_name", "strength", "dosage_form",
                  "dose_amount", "dose_unit", "route", "schedule_type", "times_of_day",
                  "times_per_day", "interval_hours", "interval_days", "weekdays",
                  "as_needed_reason", "meal_relation", "duration_value", "duration_unit",
                  "end_date", "quantity", "quantity_unit", "instructions", "sig")
        read_only_fields = ("id", "sig")
        extra_kwargs = {"medication_name": {"required": False}, "position": {"required": False}}

    def get_sig(self, obj) -> str:
        return render_sig(obj)

    def validate(self, attrs):
        med = attrs.get("medication")
        if not med and not attrs.get("medication_name"):
            raise serializers.ValidationError({"medication_name": "اختر الدواء أو اكتب اسمه."})
        schedule = attrs.get("schedule_type")
        required = {
            ScheduleType.TIMES_OF_DAY: ("times_of_day", "اختر وقتاً واحداً على الأقل."),
            ScheduleType.TIMES_PER_DAY: ("times_per_day", "حدد عدد المرات يومياً."),
            ScheduleType.EVERY_HOURS: ("interval_hours", "حدد الفاصل بالساعات."),
            ScheduleType.EVERY_DAYS: ("interval_days", "حدد الفاصل بالأيام."),
            ScheduleType.WEEKLY: ("weekdays", "اختر أيام الأسبوع."),
            ScheduleType.CUSTOM: ("instructions", "اكتب تعليمات النظام الخاص."),
        }.get(schedule)
        if required and not attrs.get(required[0]):
            raise serializers.ValidationError({required[0]: required[1]})
        if attrs.get("interval_hours") and not 1 <= attrs["interval_hours"] <= 168:
            raise serializers.ValidationError({"interval_hours": "فاصل غير منطقي."})
        if attrs.get("duration_unit") and attrs["duration_unit"] != "ongoing" \
                and not attrs.get("duration_value") and not attrs.get("end_date"):
            raise serializers.ValidationError({"duration_value": "حدد مدة العلاج."})
        return attrs


class PrescriptionSerializer(RecordMetaSerializer):
    items = PrescriptionItemSerializer(many=True, read_only=True)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)

    class Meta:
        model = Prescription
        fields = (*RecordMetaSerializer.META_FIELDS, "patient_name", "encounter", "number",
                  "diagnosis_text", "notes", "print_count", "items")
        read_only_fields = fields


class PrescriptionWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)
    items = PrescriptionItemSerializer(many=True)

    class Meta:
        model = Prescription
        fields = ("patient", "encounter", "diagnosis_text", "notes", "items")
        extra_kwargs = {"encounter": {"required": False}}

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("أضف دواءً واحداً على الأقل.")
        if len(items) > 30:
            raise serializers.ValidationError("عدد الأدوية كبير جداً.")
        return items


class TemplateSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True)

    class Meta:
        model = PrescriptionTemplate
        fields = ("id", "name", "notes", "items", "created_at")
        read_only_fields = ("created_at",)

    def _plain(self, items):
        plain = []
        for item in items:
            row = dict(item)
            if row.get("medication") is not None:
                row["medication"] = str(row["medication"].pk)
            for key in ("dose_amount", "quantity"):
                if row.get(key) is not None:
                    row[key] = str(row[key])
            if row.get("end_date"):
                row["end_date"] = row["end_date"].isoformat()
            plain.append(row)
        return plain

    def create(self, validated_data):
        validated_data["items"] = self._plain(validated_data["items"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "items" in validated_data:
            validated_data["items"] = self._plain(validated_data["items"])
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        return {"id": str(instance.pk), "name": instance.name, "notes": instance.notes,
                "items": instance.items, "created_at": instance.created_at}
