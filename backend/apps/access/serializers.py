from rest_framework import serializers

from .models import AccessGrant, AccessRequest, Purpose, Scope


class GrantSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    practitioner_name = serializers.CharField(source="practitioner.display_name", read_only=True,
                                              default=None)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    is_effective = serializers.BooleanField(read_only=True)

    class Meta:
        model = AccessGrant
        fields = ("id", "patient", "patient_name", "organization", "organization_name",
                  "practitioner", "practitioner_name", "scopes", "purpose", "method",
                  "starts_at", "expires_at", "revoked_at", "is_effective", "created_at")


class AccessRequestSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    practitioner_name = serializers.CharField(source="practitioner.display_name", read_only=True,
                                              default=None)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)

    class Meta:
        model = AccessRequest
        fields = ("id", "patient", "patient_name", "organization", "organization_name",
                  "practitioner", "practitioner_name", "scopes", "purpose", "duration_hours",
                  "note", "status", "expires_at", "decided_at", "created_at")


class PresentedIdentitySerializer(serializers.Serializer):
    patient_id = serializers.UUIDField(required=False)
    health_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    card_token = serializers.CharField(max_length=60, required=False, allow_blank=True)

    def validate(self, attrs):
        if not (attrs.get("patient_id") or attrs.get("health_number") or attrs.get("card_token")):
            raise serializers.ValidationError("حدد المريض.")
        return attrs


class InPersonGrantSerializer(PresentedIdentitySerializer):
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=Scope.choices),
                                   min_length=1)
    hours = serializers.IntegerField(min_value=1)
    attestation = serializers.CharField(max_length=300)

    def validate(self, attrs):
        # In-person grants always require the physical card or number, never just an id.
        if not (attrs.get("health_number") or attrs.get("card_token")):
            raise serializers.ValidationError("التحقق الحضوري يتطلب البطاقة أو الرقم الصحي.")
        return attrs


class AccessRequestCreateSerializer(PresentedIdentitySerializer):
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=Scope.choices),
                                   min_length=1)
    hours = serializers.IntegerField(min_value=1)
    channel = serializers.ChoiceField(choices=[("patient_app", "تطبيق المريض"),
                                               ("otp", "رمز إلى الهاتف")])
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class OtpVerifySerializer(serializers.Serializer):
    otp = serializers.CharField(max_length=10)


class PatientDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=Scope.choices),
                                   required=False)


class PatientShareSerializer(serializers.Serializer):
    patient_id = serializers.UUIDField()
    organization_id = serializers.UUIDField()
    practitioner_id = serializers.UUIDField(required=False, allow_null=True)
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=Scope.choices),
                                   min_length=1)
    days = serializers.IntegerField(min_value=1, max_value=365)
    purpose = serializers.ChoiceField(choices=Purpose.choices, default=Purpose.TREATMENT)


class AccessLogEntrySerializer(serializers.Serializer):
    occurred_at = serializers.DateTimeField()
    action = serializers.CharField()
    outcome = serializers.CharField()
    actor_name = serializers.CharField(allow_null=True)
    organization_name = serializers.CharField(allow_null=True)
