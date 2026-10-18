from django.conf import settings
from django.db import models

from apps.core.models import BaseModel

from .base import ClinicalRecord


class EncounterType(models.TextChoices):
    CONSULTATION = "consultation", "معاينة"
    FOLLOW_UP = "follow_up", "مراجعة"
    EMERGENCY = "emergency", "إسعافية"
    PROCEDURE = "procedure", "إجراء طبي"
    HOME_VISIT = "home_visit", "زيارة منزلية"


class Encounter(ClinicalRecord):
    """A visit (FHIR Encounter + clinical note). Most fields are optional on purpose (§6)."""

    SCOPE = "encounters"

    encounter_type = models.CharField(
        max_length=20, choices=EncounterType.choices, default=EncounterType.CONSULTATION
    )
    reason = models.CharField(max_length=300, blank=True)
    complaint = models.TextField(blank=True)
    history = models.TextField(blank=True)
    examination = models.TextField(blank=True)
    # Structured vitals: {"bp_systolic": 120, "bp_diastolic": 80, "heart_rate": 72,
    # "temperature_c": 37.0, "resp_rate": 16, "spo2": 98, "weight_kg": 70,
    # "height_cm": 175, "glucose_mg_dl": 95}
    vitals = models.JSONField(default=dict, blank=True)
    assessment = models.TextField(blank=True)
    plan = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    follow_up_date = models.DateField(null=True, blank=True)
    follow_up_note = models.CharField(max_length=300, blank=True)

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["patient", "-occurred_at"], name="enc_patient_time")]


class ConditionCategory(models.TextChoices):
    ENCOUNTER_DIAGNOSIS = "encounter_diagnosis", "تشخيص زيارة"
    PROBLEM_LIST = "problem_list", "مرض مزمن / مشكلة مستمرة"
    PAST_HISTORY = "past_history", "سوابق مرضية أو جراحية"


class ClinicalStatus(models.TextChoices):
    ACTIVE = "active", "نشط"
    RESOLVED = "resolved", "شُفي"
    INACTIVE = "inactive", "غير نشط"


class Condition(ClinicalRecord):
    """Diagnosis or chronic problem (FHIR Condition). ICD-10 code optional."""

    SCOPE = "encounters"

    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.PROTECT, related_name="conditions"
    )
    code = models.CharField(max_length=20, blank=True)
    code_system = models.CharField(max_length=20, blank=True, default="ICD-10")
    display = models.CharField(max_length=300)
    category = models.CharField(
        max_length=24, choices=ConditionCategory.choices,
        default=ConditionCategory.ENCOUNTER_DIAGNOSIS,
    )
    clinical_status = models.CharField(
        max_length=12, choices=ClinicalStatus.choices, default=ClinicalStatus.ACTIVE
    )
    onset_date = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=500, blank=True)

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["patient", "category"], name="cond_patient_cat")]


class AllergySeverity(models.TextChoices):
    MILD = "mild", "خفيفة"
    MODERATE = "moderate", "متوسطة"
    SEVERE = "severe", "شديدة"
    UNKNOWN = "unknown", "غير معروفة"


class AllergyCategory(models.TextChoices):
    MEDICATION = "medication", "دواء"
    FOOD = "food", "طعام"
    ENVIRONMENT = "environment", "بيئية"
    OTHER = "other", "أخرى"


class Allergy(ClinicalRecord):
    """Clinician-documented allergy (FHIR AllergyIntolerance)."""

    SCOPE = "summary"

    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.PROTECT, related_name="allergies"
    )
    substance = models.CharField(max_length=200)
    category = models.CharField(
        max_length=16, choices=AllergyCategory.choices, default=AllergyCategory.MEDICATION
    )
    reaction = models.CharField(max_length=300, blank=True)
    severity = models.CharField(
        max_length=10, choices=AllergySeverity.choices, default=AllergySeverity.UNKNOWN
    )
    is_active = models.BooleanField(default=True)

    class Meta(ClinicalRecord.Meta):
        verbose_name_plural = "allergies"


class RecordVersion(BaseModel):
    """Immutable snapshot of a finalized record before each amendment (ADR-007)."""

    record_type = models.CharField(max_length=64)
    record_id = models.UUIDField(db_index=True)
    version = models.PositiveIntegerField()
    snapshot = models.JSONField()
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                   related_name="+")
    reason = models.CharField(max_length=300)

    class Meta:
        ordering = ("record_type", "record_id", "version")
        constraints = [
            models.UniqueConstraint(
                fields=["record_type", "record_id", "version"], name="uniq_record_version"
            )
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Record versions are immutable.")
        super().save(*args, **kwargs)
