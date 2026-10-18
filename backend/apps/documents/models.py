from django.conf import settings
from django.db import models

from apps.clinical.base import ClinicalRecord
from apps.core.ids import uuid7
from apps.core.models import BaseModel


class DocumentCategory(models.TextChoices):
    LAB_RESULT = "lab_result", "نتيجة تحليل"
    XRAY = "xray", "أشعة بسيطة"
    ULTRASOUND = "ultrasound", "إيكو"
    CT = "ct", "طبقي محوري"
    MRI = "mri", "رنين مغناطيسي"
    ECG = "ecg", "تخطيط قلب"
    ECHO = "echo", "إيكو قلب"
    MEDICAL_REPORT = "medical_report", "تقرير طبي"
    PRESCRIPTION_SCAN = "prescription_scan", "صورة وصفة"
    OTHER = "other", "مستند عام"


IMAGING_CATEGORIES = {"xray", "ultrasound", "ct", "mri", "ecg", "echo"}


class ScanStatus(models.TextChoices):
    PENDING = "pending", "قيد الفحص"
    CLEAN = "clean", "سليم"
    REJECTED = "rejected", "مرفوض"


def document_upload_path(instance, filename: str) -> str:
    # Never reuse the client filename in storage keys.
    return f"documents/{instance.patient_id}/{uuid7().hex}"


class ClinicalDocument(ClinicalRecord):
    """Uploaded file (FHIR DocumentReference). Stored in the private bucket only."""

    SCOPE = "documents"

    category = models.CharField(max_length=20, choices=DocumentCategory.choices)
    title = models.CharField(max_length=200)
    description = models.CharField(max_length=500, blank=True)
    file = models.FileField(upload_to=document_upload_path, max_length=300)
    original_filename = models.CharField(max_length=200, blank=True)
    mime_type = models.CharField(max_length=80)
    size_bytes = models.PositiveBigIntegerField()
    sha256 = models.CharField(max_length=64)
    scan_status = models.CharField(
        max_length=10, choices=ScanStatus.choices, default=ScanStatus.PENDING
    )
    document_date = models.DateField(null=True, blank=True)
    encounter = models.ForeignKey(
        "clinical.Encounter", null=True, blank=True, on_delete=models.PROTECT,
        related_name="documents",
    )
    lab_report = models.ForeignKey(
        "diagnostics.LabReport", null=True, blank=True, on_delete=models.PROTECT,
        related_name="documents",
    )
    imaging_report = models.ForeignKey(
        "diagnostics.ImagingReport", null=True, blank=True, on_delete=models.PROTECT,
        related_name="documents",
    )

    class Meta(ClinicalRecord.Meta):
        indexes = [models.Index(fields=["patient", "-occurred_at"], name="doc_patient_time")]

    @property
    def record_scope(self) -> str:
        if self.category in IMAGING_CATEGORIES:
            return "imaging"
        if self.category == DocumentCategory.LAB_RESULT:
            return "labs"
        return "documents"


class OcrStatus(models.TextChoices):
    QUEUED = "queued", "في الانتظار"
    DONE = "done", "اكتمل"
    FAILED = "failed", "فشل"
    UNAVAILABLE = "unavailable", "غير متاح"
    REVIEWED = "reviewed", "رُوجع وحُوّل إلى مسودة"


class OcrResult(BaseModel):
    """Machine extraction awaiting human review. Never a clinical record by itself (§11).

    The original document is never modified. `extracted` is a *suggestion* (see
    apps.documents.ocr_parsing); only the values a reviewer submits become a draft LabReport.
    """

    document = models.OneToOneField(ClinicalDocument, on_delete=models.CASCADE, related_name="ocr")
    provider = models.CharField(max_length=60)
    engine = models.CharField(max_length=60, blank=True)
    engine_version = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=12, choices=OcrStatus.choices, default=OcrStatus.QUEUED)
    error_code = models.CharField(max_length=40, blank=True)
    text = models.TextField(blank=True)
    # Engine lines with per-line/per-word confidences, kept so the parser can be re-run.
    lines = models.JSONField(default=list, blank=True)
    pages = models.PositiveSmallIntegerField(default=0)
    suggested_category = models.CharField(max_length=20, blank=True)
    extracted = models.JSONField(default=dict, blank=True)
    mean_confidence = models.FloatField(null=True, blank=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                     on_delete=models.SET_NULL, related_name="+")
    processed_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.PROTECT, related_name="+")
    # Summary of what the reviewer changed versus the suggestion (accuracy tracking).
    review = models.JSONField(default=dict, blank=True)
    lab_report = models.ForeignKey(
        "diagnostics.LabReport", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="ocr_sources",
    )
