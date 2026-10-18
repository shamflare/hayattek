from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.db import models

from apps.clinical.base import ClinicalRecord
from apps.core.arabic import normalize_arabic
from apps.core.models import BaseModel


class DosageForm(models.TextChoices):
    TABLET = "tablet", "مضغوطات"
    CAPSULE = "capsule", "كبسولات"
    SYRUP = "syrup", "شراب"
    SUSPENSION = "suspension", "معلق"
    DROPS = "drops", "قطرة"
    INJECTION = "injection", "حقن"
    CREAM = "cream", "كريم"
    OINTMENT = "ointment", "مرهم"
    GEL = "gel", "جل"
    INHALER = "inhaler", "بخاخ استنشاق"
    NASAL_SPRAY = "nasal_spray", "بخاخ أنفي"
    SUPPOSITORY = "suppository", "تحاميل"
    SACHET = "sachet", "أكياس"
    PATCH = "patch", "لصاقة"
    EFFERVESCENT = "effervescent", "فوار"
    OTHER = "other", "أخرى"


class Route(models.TextChoices):
    ORAL = "oral", "فموي"
    SUBLINGUAL = "sublingual", "تحت اللسان"
    TOPICAL = "topical", "موضعي"
    IV = "iv", "وريدي"
    IM = "im", "عضلي"
    SC = "sc", "تحت الجلد"
    INHALATION = "inhalation", "استنشاق"
    NASAL = "nasal", "أنفي"
    OPHTHALMIC = "ophthalmic", "عيني"
    OTIC = "otic", "أذني"
    RECTAL = "rectal", "شرجي"
    VAGINAL = "vaginal", "مهبلي"
    OTHER = "other", "أخرى"


class CatalogSource(models.TextChoices):
    SYNTHETIC_TEST = "synthetic_test", "بيانات اختبار اصطناعية"
    IMPORTED = "imported", "مستورد من مصدر موثق"
    PRACTITIONER = "practitioner", "أضافه طبيب"


class Medication(BaseModel):
    """Catalog entry. Never invent active ingredients: leave blank unless sourced (§9)."""

    name = models.CharField(max_length=200, help_text="Display/trade name as prescribed.")
    brand_name = models.CharField(max_length=200, blank=True)
    active_ingredient = models.CharField(max_length=300, blank=True)
    strength = models.CharField(max_length=60, blank=True)
    dosage_form = models.CharField(max_length=20, choices=DosageForm.choices)
    unit = models.CharField(max_length=30, blank=True, help_text="Dose unit, e.g. حبة، مل")
    default_route = models.CharField(max_length=16, choices=Route.choices, default=Route.ORAL)
    is_active = models.BooleanField(default=True)
    source = models.CharField(max_length=20, choices=CatalogSource.choices)
    source_reference = models.CharField(max_length=200, blank=True)
    added_by_practitioner = models.ForeignKey(
        "practitioners.Practitioner", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    search_text = models.CharField(max_length=600, editable=False)

    class Meta:
        ordering = ("name",)
        indexes = [GinIndex(fields=["search_text"], name="med_search_trgm",
                            opclasses=["gin_trgm_ops"])]

    def __str__(self) -> str:
        return " ".join(p for p in [self.name, self.strength] if p)

    def save(self, *args, **kwargs):
        self.search_text = normalize_arabic(
            " ".join([self.name, self.brand_name, self.active_ingredient, self.strength])
        )
        super().save(*args, **kwargs)


class MedicationFavorite(BaseModel):
    """A practitioner's quick-pick list. `preset` holds the doctor's own default sig."""

    practitioner = models.ForeignKey(
        "practitioners.Practitioner", on_delete=models.CASCADE, related_name="favorite_medications"
    )
    medication = models.ForeignKey(Medication, on_delete=models.CASCADE, related_name="+")
    position = models.PositiveIntegerField(default=0)
    preset = models.JSONField(default=dict, blank=True)
    use_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("position", "-use_count")
        constraints = [
            models.UniqueConstraint(fields=["practitioner", "medication"], name="uniq_favorite")
        ]


class PrescriptionTemplate(BaseModel):
    """Reusable set of items. Items are copied into prescriptions, so editing never alters history."""

    practitioner = models.ForeignKey(
        "practitioners.Practitioner", on_delete=models.CASCADE, related_name="rx_templates"
    )
    name = models.CharField(max_length=120)
    notes = models.CharField(max_length=500, blank=True)
    items = models.JSONField(default=list)

    class Meta:
        ordering = ("name",)


class Prescription(ClinicalRecord):
    """FHIR MedicationRequest group."""

    SCOPE = "prescriptions"

    encounter = models.ForeignKey(
        "clinical.Encounter", null=True, blank=True, on_delete=models.PROTECT,
        related_name="prescriptions",
    )
    number = models.CharField(max_length=20, unique=True, editable=False)
    verification_code = models.CharField(max_length=16, unique=True, editable=False)
    diagnosis_text = models.CharField(max_length=300, blank=True)
    notes = models.TextField(blank=True)
    print_count = models.PositiveIntegerField(default=0)

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["patient", "-occurred_at"], name="rx_patient_time")]


class ScheduleType(models.TextChoices):
    TIMES_OF_DAY = "times_of_day", "أوقات محددة من اليوم"
    TIMES_PER_DAY = "times_per_day", "عدد مرات يومياً"
    EVERY_HOURS = "every_hours", "كل عدد ساعات"
    EVERY_DAYS = "every_days", "كل عدد أيام"
    WEEKLY = "weekly", "أيام محددة أسبوعياً"
    AS_NEEDED = "as_needed", "عند الحاجة"
    SINGLE_DOSE = "single_dose", "جرعة واحدة"
    CUSTOM = "custom", "نظام خاص (حسب التعليمات)"


class TimeOfDay(models.TextChoices):
    MORNING = "morning", "صباحاً"
    NOON = "noon", "ظهراً"
    EVENING = "evening", "مساءً"
    BEDTIME = "bedtime", "قبل النوم"


class MealRelation(models.TextChoices):
    BEFORE = "before", "قبل الطعام"
    AFTER = "after", "بعد الطعام"
    WITH = "with", "مع الطعام"
    INDEPENDENT = "independent", "دون ارتباط بالطعام"


class DurationUnit(models.TextChoices):
    DAYS = "days", "أيام"
    WEEKS = "weeks", "أسابيع"
    MONTHS = "months", "أشهر"
    ONGOING = "ongoing", "مستمر"


class Weekday(models.TextChoices):
    SAT = "sat", "السبت"
    SUN = "sun", "الأحد"
    MON = "mon", "الاثنين"
    TUE = "tue", "الثلاثاء"
    WED = "wed", "الأربعاء"
    THU = "thu", "الخميس"
    FRI = "fri", "الجمعة"


class PrescriptionItem(BaseModel):
    """One structured medication line. Catalog fields are snapshotted at prescribing time."""

    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="items")
    position = models.PositiveSmallIntegerField(default=0)
    medication = models.ForeignKey(
        Medication, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    medication_name = models.CharField(max_length=200)
    strength = models.CharField(max_length=60, blank=True)
    dosage_form = models.CharField(max_length=20, choices=DosageForm.choices, blank=True)

    dose_amount = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    dose_unit = models.CharField(max_length=30, blank=True)
    route = models.CharField(max_length=16, choices=Route.choices, blank=True)

    schedule_type = models.CharField(max_length=16, choices=ScheduleType.choices)
    times_of_day = ArrayField(
        models.CharField(max_length=10, choices=TimeOfDay.choices), default=list, blank=True
    )
    times_per_day = models.PositiveSmallIntegerField(null=True, blank=True)
    interval_hours = models.PositiveSmallIntegerField(null=True, blank=True)
    interval_days = models.PositiveSmallIntegerField(null=True, blank=True)
    weekdays = ArrayField(
        models.CharField(max_length=3, choices=Weekday.choices), default=list, blank=True
    )
    as_needed_reason = models.CharField(max_length=150, blank=True)
    meal_relation = models.CharField(max_length=12, choices=MealRelation.choices, blank=True)

    duration_value = models.PositiveSmallIntegerField(null=True, blank=True)
    duration_unit = models.CharField(max_length=8, choices=DurationUnit.choices, blank=True)
    end_date = models.DateField(null=True, blank=True)

    quantity = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    quantity_unit = models.CharField(max_length=30, blank=True)
    instructions = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ("position",)
