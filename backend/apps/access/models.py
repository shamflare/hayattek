from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class Scope(models.TextChoices):
    SUMMARY = "summary", "الملخص (حساسيات، أمراض مزمنة، أدوية حالية)"
    ENCOUNTERS = "encounters", "الزيارات والتشخيصات"
    PRESCRIPTIONS = "prescriptions", "الوصفات"
    LABS = "labs", "التحاليل"
    IMAGING = "imaging", "الأشعة والتصوير"
    DOCUMENTS = "documents", "المستندات"
    REFERRALS = "referrals", "الإحالات"


ALL_SCOPES = [s.value for s in Scope]


class Purpose(models.TextChoices):
    TREATMENT = "treatment", "علاج"
    REFERRAL = "referral", "إحالة"
    SECOND_OPINION = "second_opinion", "رأي طبي ثانٍ"
    DIAGNOSTICS = "diagnostics", "تحاليل أو تصوير"


class GrantMethod(models.TextChoices):
    PATIENT_APP = "patient_app", "موافقة من حساب المريض"
    OTP = "otp", "رمز تحقق إلى هاتف المريض"
    IN_PERSON = "in_person", "تحقق حضوري بالبطاقة"
    REFERRAL = "referral", "ضمن إحالة بموافقة المريض"
    PATIENT_SHARE = "patient_share", "مشاركة بادر بها المريض"


class AccessGrantQuerySet(models.QuerySet):
    def effective(self, at=None):
        at = at or timezone.now()
        return self.filter(revoked_at__isnull=True, starts_at__lte=at, expires_at__gt=at)


class AccessGrant(BaseModel):
    """Patient consent letting an organization (or one practitioner in it) read network records."""

    patient = models.ForeignKey(
        "patients.Patient", on_delete=models.CASCADE, related_name="access_grants"
    )
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="access_grants"
    )
    practitioner = models.ForeignKey(
        "practitioners.Practitioner", null=True, blank=True, on_delete=models.CASCADE,
        related_name="access_grants", help_text="Empty = any clinician of the organization.",
    )
    scopes = ArrayField(models.CharField(max_length=20, choices=Scope.choices))
    purpose = models.CharField(max_length=20, choices=Purpose.choices, default=Purpose.TREATMENT)
    method = models.CharField(max_length=20, choices=GrantMethod.choices)
    starts_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    attestation = models.CharField(
        max_length=300, blank=True, help_text="For in-person verification: what was checked."
    )
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )

    objects = AccessGrantQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["patient", "organization", "expires_at"])]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("starts_at")),
                name="grant_expires_after_start",
            )
        ]

    @property
    def is_effective(self) -> bool:
        now = timezone.now()
        return self.revoked_at is None and self.starts_at <= now < self.expires_at


class AccessRequestStatus(models.TextChoices):
    PENDING = "pending", "بانتظار الموافقة"
    APPROVED = "approved", "تمت الموافقة"
    DENIED = "denied", "مرفوض"
    EXPIRED = "expired", "منتهي"
    CANCELLED = "cancelled", "ملغى"


class AccessRequest(BaseModel):
    """A clinician asks the patient for access; approved in-app or by OTP."""

    patient = models.ForeignKey(
        "patients.Patient", on_delete=models.CASCADE, related_name="access_requests"
    )
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="+"
    )
    practitioner = models.ForeignKey(
        "practitioners.Practitioner", null=True, blank=True, on_delete=models.CASCADE,
        related_name="+",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    scopes = ArrayField(models.CharField(max_length=20, choices=Scope.choices))
    purpose = models.CharField(max_length=20, choices=Purpose.choices, default=Purpose.TREATMENT)
    duration_hours = models.PositiveIntegerField(default=24)
    note = models.CharField(max_length=300, blank=True)
    status = models.CharField(
        max_length=12, choices=AccessRequestStatus.choices, default=AccessRequestStatus.PENDING
    )
    expires_at = models.DateTimeField(help_text="Request must be decided before this time.")
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    otp_hash = models.CharField(max_length=128, blank=True)
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    otp_attempts = models.PositiveSmallIntegerField(default=0)
    grant = models.OneToOneField(
        AccessGrant, null=True, blank=True, on_delete=models.SET_NULL, related_name="request"
    )

    class Meta:
        ordering = ("-created_at",)
