import uuid

from django.conf import settings
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


class ReviewStatus(models.TextChoices):
    """Review of medicines added by practitioners ("unknown medications")."""

    NONE = "", "لا يحتاج مراجعة"
    PENDING = "pending", "بانتظار المراجعة"
    ACCEPTED = "accepted", "أُبقي في الكتالوج"
    MERGED = "merged", "دُمج في صنف موجود"


class Medication(BaseModel):
    """Catalog entry. Never invent active ingredients: leave blank unless sourced (§9).

    Provenance (§11): every imported entry records its source, version/date and the import
    batch. Synthetic development data is flagged `is_synthetic` and hidden from search when
    HAYAT["CATALOG_INCLUDE_SYNTHETIC"] is false (production).
    """

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

    manufacturer = models.CharField(max_length=200, blank=True)
    country_of_registration = models.CharField(max_length=80, blank=True)
    registration_number = models.CharField(max_length=80, blank=True)
    source_name = models.CharField(max_length=200, blank=True,
                                   help_text="Declared data source, e.g. the licensed catalog.")
    source_version = models.CharField(max_length=60, blank=True)
    source_date = models.DateField(null=True, blank=True)
    imported_at = models.DateTimeField(null=True, blank=True)
    external_id = models.CharField(max_length=120, blank=True, db_index=True,
                                   help_text="Identifier of the entry in its source.")
    is_synthetic = models.BooleanField(default=False, db_index=True)
    dedupe_key = models.CharField(max_length=600, blank=True, db_index=True, editable=False)
    catalog_import = models.ForeignKey("CatalogImport", null=True, blank=True,
                                       on_delete=models.SET_NULL, related_name="medications")
    review_status = models.CharField(max_length=10, choices=ReviewStatus.choices, blank=True,
                                     default=ReviewStatus.NONE, db_index=True)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("name",)
        indexes = [GinIndex(fields=["search_text"], name="med_search_trgm",
                            opclasses=["gin_trgm_ops"])]

    def __str__(self) -> str:
        return " ".join(p for p in [self.name, self.strength] if p)

    def save(self, *args, **kwargs):
        from .catalog import dedupe_key

        self.search_text = normalize_arabic(
            " ".join([self.name, self.brand_name, self.active_ingredient, self.strength])
        )
        self.dedupe_key = dedupe_key(self.name, self.strength, self.dosage_form,
                                     self.manufacturer)
        if self.source == CatalogSource.SYNTHETIC_TEST:
            self.is_synthetic = True
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], "search_text", "dedupe_key",
                                       "is_synthetic"}
        super().save(*args, **kwargs)


class ImportStatus(models.TextChoices):
    PREVIEWED = "previewed", "معاينة (لم يُستورد بعد)"
    COMMITTED = "committed", "تم الاستيراد"
    DISCARDED = "discarded", "أُلغي"
    FAILED = "failed", "فشل"


def _import_upload_to(instance, filename: str) -> str:
    ext = "json" if filename.lower().endswith(".json") else "csv"
    return f"catalog-imports/{uuid.uuid4().hex}.{ext}"


class CatalogImport(BaseModel):
    """One upload of a medication catalog file: declared source + licence, dry-run preview,
    then an explicit commit by a platform administrator (§11, ADR-028)."""

    file = models.FileField(upload_to=_import_upload_to)
    original_filename = models.CharField(max_length=200, blank=True)
    file_format = models.CharField(max_length=8, default="csv")
    sha256 = models.CharField(max_length=64, blank=True)
    source_name = models.CharField(max_length=200)
    source_version = models.CharField(max_length=60, blank=True)
    source_date = models.DateField(null=True, blank=True)
    source_url = models.CharField(max_length=300, blank=True)
    license_text = models.CharField(
        max_length=1000, help_text="Licence / written permission allowing reuse of the data.")
    license_confirmed = models.BooleanField(default=False)
    is_synthetic = models.BooleanField(default=False,
                                       help_text="Synthetic sample data (development only).")
    status = models.CharField(max_length=10, choices=ImportStatus.choices,
                              default=ImportStatus.PREVIEWED, db_index=True)
    total_rows = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    unchanged_count = models.PositiveIntegerField(default=0)
    duplicate_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    error_report = models.JSONField(default=list, blank=True)
    preview = models.JSONField(default=list, blank=True)
    imported_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                    on_delete=models.SET_NULL, related_name="+")
    committed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)


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
