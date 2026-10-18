from datetime import date

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.db import models
from django.utils import timezone

from apps.core.arabic import normalize_arabic
from apps.core.models import BaseModel, Governorate


class Sex(models.TextChoices):
    MALE = "male", "ذكر"
    FEMALE = "female", "أنثى"
    UNKNOWN = "unknown", "غير محدد"


class BirthDatePrecision(models.TextChoices):
    EXACT = "exact", "دقيق"
    YEAR = "year", "السنة فقط"
    ESTIMATED = "estimated", "تقديري"


class PatientStatus(models.TextChoices):
    ACTIVE = "active", "فعال"
    MERGED = "merged", "مدمج"
    DECEASED = "deceased", "متوفى"


class Patient(BaseModel):
    """Lifelong patient identity (FHIR Patient). Never keyed on phone or national ID."""

    health_number = models.CharField(max_length=16, unique=True, editable=False)

    first_name = models.CharField(max_length=60)
    father_name = models.CharField(max_length=60, blank=True)
    grandfather_name = models.CharField(max_length=60, blank=True)
    family_name = models.CharField(max_length=60, blank=True)
    mother_name = models.CharField(max_length=60, blank=True)
    full_name_en = models.CharField(max_length=200, blank=True)
    name_search = models.CharField(max_length=300, editable=False, db_index=True)

    sex = models.CharField(max_length=10, choices=Sex.choices, default=Sex.UNKNOWN)
    birth_date = models.DateField(null=True, blank=True)
    birth_date_precision = models.CharField(
        max_length=10, choices=BirthDatePrecision.choices, default=BirthDatePrecision.EXACT
    )

    phone = models.CharField(max_length=20, blank=True, db_index=True)
    national_id = models.CharField(max_length=30, blank=True)
    governorate = models.CharField(
        max_length=32, choices=Governorate.choices, default=Governorate.RAQQA
    )
    city = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=300, blank=True)

    emergency_contact_name = models.CharField(max_length=120, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)
    emergency_contact_relation = models.CharField(max_length=60, blank=True)

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="patient_profile",
    )
    status = models.CharField(
        max_length=12, choices=PatientStatus.choices, default=PatientStatus.ACTIVE
    )
    merged_into = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at_organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            GinIndex(fields=["name_search"], name="patient_name_trgm",
                     opclasses=["gin_trgm_ops"]),
        ]

    def __str__(self) -> str:
        return self.full_name

    @property
    def full_name(self) -> str:
        parts = [self.first_name, self.father_name, self.grandfather_name, self.family_name]
        return " ".join(p for p in parts if p)

    @property
    def age_years(self) -> int | None:
        if not self.birth_date:
            return None
        today = timezone.localdate()
        return today.year - self.birth_date.year - (
            (today.month, today.day) < (self.birth_date.month, self.birth_date.day)
        )

    @property
    def formatted_health_number(self) -> str:
        n = self.health_number
        return " ".join([n[0:4], n[4:8], n[8:]]).strip()

    def save(self, *args, **kwargs):
        self.name_search = normalize_arabic(
            " ".join([self.full_name, self.mother_name, self.full_name_en])
        )
        super().save(*args, **kwargs)

    def is_minor(self, on: date | None = None) -> bool:
        age = self.age_years
        return age is not None and age < 18


class CardStatus(models.TextChoices):
    ACTIVE = "active", "فعالة"
    REVOKED = "revoked", "مبطلة"


class HealthCard(BaseModel):
    """QR card. The token is random and independent from the health number (ADR-004)."""

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="cards")
    token = models.CharField(max_length=40, unique=True)
    status = models.CharField(max_length=10, choices=CardStatus.choices, default=CardStatus.ACTIVE)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["patient"], condition=models.Q(status="active"),
                name="one_active_card_per_patient",
            )
        ]


class RegistrationStatus(models.TextChoices):
    ACTIVE = "active", "فعال"
    INACTIVE = "inactive", "غير فعال"


class PatientRegistration(BaseModel):
    """The patient is a patient of this organization (enables the org's own chart)."""

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="registrations")
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.CASCADE, related_name="registrations"
    )
    local_file_number = models.CharField(max_length=40, blank=True)
    status = models.CharField(
        max_length=10, choices=RegistrationStatus.choices, default=RegistrationStatus.ACTIVE
    )
    registered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    last_visit_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["patient", "organization"], name="uniq_registration")
        ]


class GuardianRelationship(models.TextChoices):
    PARENT = "parent", "أب/أم"
    LEGAL_GUARDIAN = "legal_guardian", "وصي قانوني"
    CAREGIVER = "caregiver", "مقدم رعاية مفوض"


class PatientGuardian(BaseModel):
    """A user who may act for a patient (child, dependent). Time-bound and verified."""

    guardian = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wards"
    )
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="guardians")
    relationship = models.CharField(max_length=20, choices=GuardianRelationship.choices)
    can_view_records = models.BooleanField(default=True)
    can_manage_sharing = models.BooleanField(default=True)
    valid_until = models.DateField(
        null=True, blank=True, help_text="E.g. the child's 18th birthday."
    )
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["guardian", "patient"], name="uniq_guardian")
        ]

    @property
    def is_effective(self) -> bool:
        if self.revoked_at:
            return False
        return not (self.valid_until and self.valid_until < timezone.localdate())


class ReportedKind(models.TextChoices):
    ALLERGY = "allergy", "حساسية"
    CONDITION = "condition", "مرض مزمن"
    MEDICATION = "medication", "دواء أتناوله"
    SURGERY = "surgery", "عملية سابقة"
    OTHER = "other", "أخرى"


class PatientReportedInfo(BaseModel):
    """Information the patient declares; always displayed as patient-reported, never as verified."""

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="reported_info")
    kind = models.CharField(max_length=20, choices=ReportedKind.choices)
    text = models.CharField(max_length=500)
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    is_active = models.BooleanField(default=True)


class CorrectionRequestStatus(models.TextChoices):
    OPEN = "open", "مفتوح"
    RESOLVED = "resolved", "تمت المعالجة"
    REJECTED = "rejected", "مرفوض"


class CorrectionRequest(BaseModel):
    """Patient asks the author to correct a clinical record (patients never edit them)."""

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="+")
    target_type = models.CharField(max_length=64)
    target_id = models.UUIDField()
    organization = models.ForeignKey(
        "organizations.Organization", null=True, on_delete=models.SET_NULL, related_name="+"
    )
    message = models.CharField(max_length=1000)
    status = models.CharField(
        max_length=10, choices=CorrectionRequestStatus.choices,
        default=CorrectionRequestStatus.OPEN,
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    response = models.CharField(max_length=1000, blank=True)
