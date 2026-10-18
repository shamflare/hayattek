from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.organizations.models import Membership, Organization
from apps.patients.models import Patient
from apps.practitioners.models import Practitioner

from .models import User


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=254, help_text="Email or phone number")
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    otp = serializers.CharField(max_length=10, required=False, allow_blank=True)


class TokenLoginSerializer(LoginSerializer):
    device_name = serializers.CharField(max_length=100, required=False, allow_blank=True)


class OrganizationBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ("id", "name", "name_en", "kind", "governorate", "status")


class MembershipBriefSerializer(serializers.ModelSerializer):
    organization = OrganizationBriefSerializer()

    class Meta:
        model = Membership
        fields = ("id", "organization", "roles", "title", "status")


class PractitionerBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Practitioner
        fields = ("id", "display_name", "display_name_en", "specialty", "specialty_detail",
                  "verification_status")


class PatientBriefSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    health_number = serializers.CharField(source="formatted_health_number", read_only=True)

    class Meta:
        model = Patient
        fields = ("id", "full_name", "health_number")


class MeSerializer(serializers.ModelSerializer):
    memberships = serializers.SerializerMethodField()
    practitioner = serializers.SerializerMethodField()
    patient = serializers.SerializerMethodField()
    wards = serializers.SerializerMethodField()
    mfa_setup_required = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "full_name", "email", "phone", "preferred_language", "is_platform_admin",
                  "mfa_enabled", "mfa_setup_required", "must_change_password", "memberships",
                  "practitioner", "patient", "wards")

    def get_memberships(self, user) -> list[dict]:
        qs = (user.memberships.filter(status="active", organization__status="active")
              .select_related("organization"))
        return MembershipBriefSerializer(qs, many=True).data

    def get_practitioner(self, user) -> dict | None:
        practitioner = getattr(user, "practitioner", None)
        return PractitionerBriefSerializer(practitioner).data if practitioner else None

    def get_patient(self, user) -> dict | None:
        patient = getattr(user, "patient_profile", None)
        return PatientBriefSerializer(patient).data if patient else None

    def get_wards(self, user) -> list[dict]:
        from apps.access.policy import patient_ids_for_user

        own = getattr(user, "patient_profile", None)
        ids = [pid for pid in patient_ids_for_user(user) if not own or pid != own.pk]
        return PatientBriefSerializer(Patient.objects.filter(pk__in=ids), many=True).data

    def get_mfa_setup_required(self, user) -> bool:
        from .services import requires_mfa

        return requires_mfa(user)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False, min_length=10)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "كلمة المرور الحالية غير صحيحة."})
        validate_password(attrs["new_password"], user)
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=254)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False, min_length=10)


class OtpSerializer(serializers.Serializer):
    otp = serializers.CharField(max_length=10)


class MfaSetupSerializer(serializers.Serializer):
    secret = serializers.CharField()
    otpauth_uri = serializers.CharField()


class TokenResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    expires_at = serializers.DateTimeField()
    user = MeSerializer()


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("full_name", "preferred_language")
