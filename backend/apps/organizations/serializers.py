from rest_framework import serializers

from apps.accounts.models import User
from apps.practitioners.models import Practitioner, Specialty

from .models import (
    Department,
    Membership,
    Organization,
    Role,
    Subscription,
    SubscriptionPlan,
)


class OrganizationSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True, required=False)
    has_logo = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = ("id", "name", "name_en", "kind", "status", "governorate", "city", "address",
                  "phone", "email", "license_number", "print_footer", "has_logo",
                  "member_count", "created_at")
        read_only_fields = ("status", "created_at")

    def get_has_logo(self, obj) -> bool:
        return bool(obj.logo)


class OrgSelfSerializer(OrganizationSerializer):
    """What an organization admin may edit about their own organization."""

    class Meta(OrganizationSerializer.Meta):
        read_only_fields = ("status", "kind", "license_number", "created_at")


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "full_name", "email", "phone", "is_active", "mfa_enabled",
                  "last_login", "is_platform_admin")


class PractitionerSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)

    class Meta:
        model = Practitioner
        fields = ("id", "user", "display_name", "display_name_en", "specialty",
                  "specialty_detail", "license_number", "license_authority",
                  "verification_status", "verified_at", "verification_notes", "created_at")
        read_only_fields = ("verification_status", "verified_at", "verification_notes",
                            "created_at")


class MembershipSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)
    practitioner = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields = ("id", "user", "roles", "title", "department", "status", "practitioner",
                  "created_at")
        read_only_fields = ("created_at",)

    def get_practitioner(self, obj) -> dict | None:
        practitioner = getattr(obj.user, "practitioner", None)
        if practitioner is None:
            return None
        return {"id": str(practitioner.pk), "display_name": practitioner.display_name,
                "specialty": practitioner.specialty,
                "verification_status": practitioner.verification_status}


class MembershipUpdateSerializer(serializers.ModelSerializer):
    roles = serializers.ListField(child=serializers.ChoiceField(choices=Role.choices),
                                  min_length=1)

    class Meta:
        model = Membership
        fields = ("roles", "title", "department", "status")


class PractitionerInputSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    display_name_en = serializers.CharField(max_length=200, required=False, allow_blank=True)
    specialty = serializers.ChoiceField(choices=Specialty.choices)
    specialty_detail = serializers.CharField(max_length=150, required=False, allow_blank=True)
    license_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    license_authority = serializers.CharField(max_length=150, required=False, allow_blank=True)


class MemberCreateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=200)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    roles = serializers.ListField(child=serializers.ChoiceField(choices=Role.choices),
                                  min_length=1)
    title = serializers.CharField(max_length=100, required=False, allow_blank=True)
    practitioner = PractitionerInputSerializer(required=False)


class MemberCreateResponseSerializer(serializers.Serializer):
    membership = MembershipSerializer()
    user_created = serializers.BooleanField()
    setup_link = serializers.CharField(
        help_text="One-time password setup link (development only; emailed in production).",
        allow_blank=True,
    )


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ("id", "name")


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = ("id", "code", "name", "description", "max_members", "monthly_price_note",
                  "is_active")


class SubscriptionSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True)

    class Meta:
        model = Subscription
        fields = ("id", "organization", "plan", "plan_name", "status", "starts_on", "ends_on",
                  "notes")


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.CharField()
    notes = serializers.CharField(required=False, allow_blank=True, max_length=300)


class PublicOrganizationSerializer(serializers.ModelSerializer):
    """Directory entry visible to any signed-in clinician (for referrals and lab routing)."""

    class Meta:
        model = Organization
        fields = ("id", "name", "kind", "governorate", "city")


class PublicPractitionerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Practitioner
        fields = ("id", "display_name", "specialty", "specialty_detail")
