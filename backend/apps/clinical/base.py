"""Common shape of every clinical record (ADR-007, FHIR Provenance-like metadata)."""

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class RecordStatus(models.TextChoices):
    DRAFT = "draft", "مسودة"
    FINAL = "final", "معتمد"
    AMENDED = "amended", "مصحح"
    ENTERED_IN_ERROR = "entered_in_error", "ملغى (أُدخل خطأً)"


VISIBLE_STATUSES = (RecordStatus.FINAL, RecordStatus.AMENDED, RecordStatus.ENTERED_IN_ERROR)


class RecordSource(models.TextChoices):
    CLINICIAN = "clinician", "طبيب"
    LABORATORY = "laboratory", "مختبر"
    IMAGING = "imaging", "مركز تصوير"
    PATIENT = "patient", "المريض"
    DOCUMENT_IMPORT = "document_import", "مستند مستورد"


class ClinicalRecord(BaseModel):
    # Access scope this record belongs to (see apps.access.models.Scope).
    SCOPE: str = ""

    patient = models.ForeignKey(
        "patients.Patient", on_delete=models.PROTECT, related_name="+"
    )
    organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT,
        related_name="+",
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                               related_name="+")
    practitioner = models.ForeignKey(
        "practitioners.Practitioner", null=True, blank=True, on_delete=models.PROTECT,
        related_name="+",
    )
    author_role = models.CharField(max_length=32, blank=True)
    status = models.CharField(
        max_length=20, choices=RecordStatus.choices, default=RecordStatus.DRAFT, db_index=True
    )
    source = models.CharField(
        max_length=20, choices=RecordSource.choices, default=RecordSource.CLINICIAN
    )
    occurred_at = models.DateTimeField(default=timezone.now)
    finalized_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    amended_at = models.DateTimeField(null=True, blank=True)
    status_reason = models.CharField(max_length=300, blank=True)

    class Meta:
        abstract = True
        ordering = ("-occurred_at",)

    @property
    def is_draft(self) -> bool:
        return self.status == RecordStatus.DRAFT

    @property
    def is_locked(self) -> bool:
        return self.status != RecordStatus.DRAFT
