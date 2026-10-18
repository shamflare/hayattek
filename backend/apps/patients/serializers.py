from rest_framework import serializers

from .models import (
    GuardianRelationship,
    HealthCard,
    Patient,
    PatientGuardian,
    PatientRegistration,
    PatientReportedInfo,
)

DEMOGRAPHIC_INPUT_FIELDS = (
    "first_name", "father_name", "grandfather_name", "family_name", "mother_name",
    "full_name_en", "sex", "birth_date", "birth_date_precision", "phone", "national_id",
    "governorate", "city", "address", "emergency_contact_name", "emergency_contact_phone",
    "emergency_contact_relation",
)


class PatientListSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    health_number = serializers.CharField(source="formatted_health_number", read_only=True)
    age_years = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = Patient
        fields = ("id", "health_number", "full_name", "sex", "age_years", "birth_date",
                  "birth_date_precision", "phone", "governorate")


class PatientDetailSerializer(PatientListSerializer):
    has_account = serializers.SerializerMethodField()

    class Meta(PatientListSerializer.Meta):
        fields = (*PatientListSerializer.Meta.fields, "first_name", "father_name",
                  "grandfather_name", "family_name", "mother_name", "full_name_en", "city",
                  "address", "emergency_contact_name", "emergency_contact_phone",
                  "emergency_contact_relation", "status", "has_account", "created_at")

    def get_has_account(self, obj) -> bool:
        return obj.user_id is not None


class PatientWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Patient
        fields = DEMOGRAPHIC_INPUT_FIELDS

    def validate(self, attrs):
        if attrs.get("birth_date") and attrs["birth_date"].year < 1890:
            raise serializers.ValidationError({"birth_date": "تاريخ الميلاد غير منطقي."})
        return attrs


class PatientCreateSerializer(PatientWriteSerializer):
    acknowledge_duplicates = serializers.BooleanField(default=False, write_only=True)

    class Meta(PatientWriteSerializer.Meta):
        fields = (*DEMOGRAPHIC_INPUT_FIELDS, "acknowledge_duplicates")


class PatientSelfUpdateSerializer(serializers.ModelSerializer):
    """What a patient may change themselves (contact data only)."""

    class Meta:
        model = Patient
        fields = ("phone", "city", "address", "full_name_en", "emergency_contact_name",
                  "emergency_contact_phone", "emergency_contact_relation")


class DuplicateCheckSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=60)
    father_name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    family_name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    birth_year = serializers.IntegerField(required=False, allow_null=True, min_value=1890)
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)


class DuplicateCheckResponseSerializer(serializers.Serializer):
    candidates = PatientListSerializer(many=True)
    network_match_hint = serializers.BooleanField()


class IdentifySerializer(serializers.Serializer):
    health_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    card_token = serializers.CharField(max_length=60, required=False, allow_blank=True)

    def validate(self, attrs):
        if not attrs.get("health_number") and not attrs.get("card_token"):
            raise serializers.ValidationError("أدخل الرقم الصحي أو امسح البطاقة.")
        return attrs


class HealthCardSerializer(serializers.ModelSerializer):
    qr_url = serializers.SerializerMethodField()

    class Meta:
        model = HealthCard
        fields = ("id", "status", "qr_url", "created_at", "revoked_at")

    def get_qr_url(self, obj) -> str:
        from .services import card_url

        return card_url(obj) if obj.status == "active" else ""


class ReissueCardSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200)


class RegistrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PatientRegistration
        fields = ("id", "local_file_number", "status", "created_at", "last_visit_at")


class PatientReportedInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PatientReportedInfo
        fields = ("id", "kind", "text", "is_active", "created_at")
        read_only_fields = ("created_at",)


class GuardianSerializer(serializers.ModelSerializer):
    guardian_name = serializers.CharField(source="guardian.full_name", read_only=True)
    patient = PatientListSerializer(read_only=True)

    class Meta:
        model = PatientGuardian
        fields = ("id", "guardian_name", "patient", "relationship", "can_view_records",
                  "can_manage_sharing", "valid_until", "revoked_at")


class ActivateAccountSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)


class LinkGuardianSerializer(serializers.Serializer):
    guardian_health_number = serializers.CharField(max_length=20)
    relationship = serializers.ChoiceField(choices=GuardianRelationship.choices)
    valid_until = serializers.DateField(required=False, allow_null=True)
