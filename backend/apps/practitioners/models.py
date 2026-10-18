from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class Specialty(models.TextChoices):
    GENERAL_PRACTICE = "general_practice", "طب عام"
    FAMILY_MEDICINE = "family_medicine", "طب أسرة"
    INTERNAL_MEDICINE = "internal_medicine", "داخلية"
    PEDIATRICS = "pediatrics", "أطفال"
    OBGYN = "obgyn", "نسائية وتوليد"
    CARDIOLOGY = "cardiology", "قلبية"
    DERMATOLOGY = "dermatology", "جلدية"
    ORTHOPEDICS = "orthopedics", "عظمية"
    ENT = "ent", "أذن وأنف وحنجرة"
    OPHTHALMOLOGY = "ophthalmology", "عينية"
    NEUROLOGY = "neurology", "عصبية"
    PSYCHIATRY = "psychiatry", "نفسية"
    UROLOGY = "urology", "بولية"
    GENERAL_SURGERY = "general_surgery", "جراحة عامة"
    ENDOCRINOLOGY = "endocrinology", "غدد صم"
    GASTROENTEROLOGY = "gastroenterology", "هضمية"
    NEPHROLOGY = "nephrology", "كلية"
    PULMONOLOGY = "pulmonology", "صدرية"
    DENTISTRY = "dentistry", "أسنان"
    RADIOLOGY = "radiology", "أشعة"
    LABORATORY_MEDICINE = "laboratory_medicine", "مخبري"
    OTHER = "other", "أخرى"


class VerificationStatus(models.TextChoices):
    PENDING = "pending", "بانتظار التحقق"
    VERIFIED = "verified", "معتمد"
    REJECTED = "rejected", "مرفوض"
    SUSPENDED = "suspended", "موقوف"


class Practitioner(BaseModel):
    """One professional identity per clinician, regardless of how many facilities (§7)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="practitioner"
    )
    display_name = models.CharField(max_length=200, help_text="As printed: د. ...")
    display_name_en = models.CharField(max_length=200, blank=True)
    specialty = models.CharField(max_length=40, choices=Specialty.choices)
    specialty_detail = models.CharField(max_length=150, blank=True)
    license_number = models.CharField(max_length=100, blank=True)
    license_authority = models.CharField(max_length=150, blank=True)
    verification_status = models.CharField(
        max_length=16, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ("display_name",)
        indexes = [models.Index(fields=["verification_status"])]

    def __str__(self) -> str:
        return self.display_name

    @property
    def is_verified(self) -> bool:
        return self.verification_status == VerificationStatus.VERIFIED
