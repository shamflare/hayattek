from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.core.models import BaseModel, Governorate


class OrganizationKind(models.TextChoices):
    CLINIC = "clinic", "عيادة خاصة"
    MEDICAL_CENTER = "medical_center", "مجمع طبي"
    HOSPITAL = "hospital", "مشفى خاص"
    LABORATORY = "laboratory", "مختبر طبي"
    IMAGING_CENTER = "imaging_center", "مركز أشعة وتصوير"


class OrganizationStatus(models.TextChoices):
    PENDING = "pending", "بانتظار الاعتماد"
    ACTIVE = "active", "فعالة"
    SUSPENDED = "suspended", "معلقة"


class Organization(BaseModel):
    """A subscribing healthcare facility (FHIR Organization)."""

    name = models.CharField(max_length=200)
    name_en = models.CharField(max_length=200, blank=True)
    kind = models.CharField(max_length=32, choices=OrganizationKind.choices)
    status = models.CharField(
        max_length=16, choices=OrganizationStatus.choices, default=OrganizationStatus.PENDING
    )
    governorate = models.CharField(
        max_length=32, choices=Governorate.choices, default=Governorate.RAQQA
    )
    city = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    license_number = models.CharField(max_length=100, blank=True)
    logo = models.ImageField(upload_to="org-logos/", null=True, blank=True)
    print_footer = models.CharField(
        max_length=300, blank=True, help_text="Printed at the bottom of prescriptions."
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ("name",)
        indexes = [models.Index(fields=["kind", "status"])]

    def __str__(self) -> str:
        return self.name

    @property
    def is_active(self) -> bool:
        return self.status == OrganizationStatus.ACTIVE

    @property
    def is_diagnostic_provider(self) -> bool:
        return self.kind in (OrganizationKind.LABORATORY, OrganizationKind.IMAGING_CENTER,
                             OrganizationKind.HOSPITAL, OrganizationKind.MEDICAL_CENTER)


class Department(BaseModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="departments"
    )
    name = models.CharField(max_length=150)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_department_name")
        ]

    def __str__(self) -> str:
        return self.name


class Role(models.TextChoices):
    ORG_ADMIN = "org_admin", "مدير المنشأة"
    PHYSICIAN = "physician", "طبيب"
    NURSE = "nurse", "ممرض"
    RECEPTIONIST = "receptionist", "استقبال"
    LAB_STAFF = "lab_staff", "مختبر"
    IMAGING_STAFF = "imaging_staff", "تصوير طبي"


class MembershipStatus(models.TextChoices):
    ACTIVE = "active", "فعالة"
    SUSPENDED = "suspended", "معلقة"
    ENDED = "ended", "منتهية"


class Membership(BaseModel):
    """Links a user to an organization with one or more roles (ADR-005)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    roles = ArrayField(models.CharField(max_length=32, choices=Role.choices), default=list)
    title = models.CharField(max_length=100, blank=True)
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="members"
    )
    status = models.CharField(
        max_length=16, choices=MembershipStatus.choices, default=MembershipStatus.ACTIVE
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ("organization__name",)
        constraints = [
            models.UniqueConstraint(fields=["user", "organization"], name="uniq_membership")
        ]

    def __str__(self) -> str:
        return f"{self.user} @ {self.organization}"

    def has_role(self, *roles: str) -> bool:
        return any(r in self.roles for r in roles)


class SubscriptionPlan(BaseModel):
    code = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True)
    max_members = models.PositiveIntegerField(null=True, blank=True)
    monthly_price_note = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class SubscriptionStatus(models.TextChoices):
    TRIAL = "trial", "تجريبي"
    ACTIVE = "active", "فعال"
    SUSPENDED = "suspended", "معلق"
    CANCELLED = "cancelled", "ملغى"


class Subscription(BaseModel):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="subscriptions"
    )
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT)
    status = models.CharField(
        max_length=16, choices=SubscriptionStatus.choices, default=SubscriptionStatus.TRIAL
    )
    starts_on = models.DateField()
    ends_on = models.DateField(null=True, blank=True)
    notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ("-starts_on",)
