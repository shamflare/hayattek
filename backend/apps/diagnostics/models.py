from django.db import models

from apps.clinical.base import ClinicalRecord
from apps.core.models import BaseModel


class LabTestType(BaseModel):
    """Catalog of orderable tests. Reference ranges are NOT stored here (§10): they come
    from each laboratory's report."""

    code = models.CharField(max_length=30, unique=True)
    name_ar = models.CharField(max_length=150)
    name_en = models.CharField(max_length=150)
    category = models.CharField(max_length=60, blank=True)
    specimen = models.CharField(max_length=60, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("category", "name_en")

    def __str__(self) -> str:
        return f"{self.name_en} ({self.code})"


class RequestKind(models.TextChoices):
    LAB = "lab", "تحليل مخبري"
    IMAGING = "imaging", "تصوير طبي"


class Priority(models.TextChoices):
    ROUTINE = "routine", "عادي"
    URGENT = "urgent", "عاجل"


class FulfillmentStatus(models.TextChoices):
    REQUESTED = "requested", "مطلوب"
    RECEIVED = "received", "استلمته الجهة المنفذة"
    IN_PROGRESS = "in_progress", "قيد التنفيذ"
    COMPLETED = "completed", "صدرت النتيجة"
    CANCELLED = "cancelled", "ملغى"


class ImagingModality(models.TextChoices):
    XRAY = "xray", "أشعة بسيطة"
    ULTRASOUND = "ultrasound", "إيكو / أمواج فوق صوتية"
    CT = "ct", "طبقي محوري"
    MRI = "mri", "رنين مغناطيسي"
    ECG = "ecg", "تخطيط قلب"
    ECHO = "echo", "إيكو قلب"
    MAMMOGRAPHY = "mammography", "تصوير الثدي"
    OTHER = "other", "أخرى"


class ServiceRequest(ClinicalRecord):
    """Lab or imaging order (FHIR ServiceRequest)."""

    SCOPE = "labs"

    kind = models.CharField(max_length=10, choices=RequestKind.choices)
    encounter = models.ForeignKey(
        "clinical.Encounter", null=True, blank=True, on_delete=models.PROTECT,
        related_name="service_requests",
    )
    number = models.CharField(max_length=20, unique=True, editable=False)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.ROUTINE)
    performer_organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT,
        related_name="incoming_requests",
    )
    clinical_notes = models.CharField(max_length=500, blank=True)
    fulfillment_status = models.CharField(
        max_length=12, choices=FulfillmentStatus.choices, default=FulfillmentStatus.REQUESTED,
        db_index=True,
    )

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["performer_organization", "fulfillment_status"],
                                name="sr_performer_status")]

    @property
    def record_scope(self) -> str:
        return "labs" if self.kind == RequestKind.LAB else "imaging"


class ServiceRequestItem(BaseModel):
    request = models.ForeignKey(ServiceRequest, on_delete=models.CASCADE, related_name="items")
    lab_test = models.ForeignKey(
        LabTestType, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    modality = models.CharField(max_length=16, choices=ImagingModality.choices, blank=True)
    body_site = models.CharField(max_length=120, blank=True)
    description = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ("created_at",)


class LabReport(ClinicalRecord):
    """Laboratory report (FHIR DiagnosticReport). `organization` = performing lab."""

    SCOPE = "labs"

    service_request = models.ForeignKey(
        ServiceRequest, null=True, blank=True, on_delete=models.PROTECT, related_name="lab_reports"
    )
    title = models.CharField(max_length=200)
    specimen_collected_at = models.DateTimeField(null=True, blank=True)
    conclusion = models.TextField(blank=True)
    external_lab_name = models.CharField(
        max_length=200, blank=True, help_text="For imported paper results from non-member labs."
    )

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["patient", "-occurred_at"], name="lab_patient_time")]


class Interpretation(models.TextChoices):
    NORMAL = "normal", "طبيعي"
    LOW = "low", "منخفض"
    HIGH = "high", "مرتفع"
    CRITICAL_LOW = "critical_low", "منخفض جداً"
    CRITICAL_HIGH = "critical_high", "مرتفع جداً"
    ABNORMAL = "abnormal", "غير طبيعي"


class LabObservation(BaseModel):
    """One result value (FHIR Observation). Units and ranges are exactly as issued by the lab."""

    report = models.ForeignKey(LabReport, on_delete=models.CASCADE, related_name="observations")
    position = models.PositiveSmallIntegerField(default=0)
    test = models.ForeignKey(
        LabTestType, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    name = models.CharField(max_length=150)
    value_numeric = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    value_text = models.CharField(max_length=200, blank=True)
    unit = models.CharField(max_length=40, blank=True)
    reference_low = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    reference_high = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    reference_text = models.CharField(max_length=150, blank=True)
    interpretation = models.CharField(max_length=16, choices=Interpretation.choices, blank=True)
    method = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ("position",)


class ImagingReport(ClinicalRecord):
    """Radiology/ECG report text. Pixel data lives in documents (DICOM support later)."""

    SCOPE = "imaging"

    service_request = models.ForeignKey(
        ServiceRequest, null=True, blank=True, on_delete=models.PROTECT,
        related_name="imaging_reports",
    )
    modality = models.CharField(max_length=16, choices=ImagingModality.choices)
    body_site = models.CharField(max_length=120, blank=True)
    title = models.CharField(max_length=200)
    findings = models.TextField(blank=True)
    impression = models.TextField(blank=True)

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["patient", "-occurred_at"], name="img_patient_time")]
