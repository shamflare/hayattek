"""DICOM studies held in the private image store (Orthanc).

The HAYAT record is the source of truth: a study belongs to exactly one ClinicalDocument and
reaches its patient / organization / encounter / imaging report only through it. Orthanc
identifiers are internal and never leave the server (ADR-030).
"""

from django.db import models

from apps.core.models import BaseModel

DICOM_MIME = "application/dicom"
# A ZIP of one DICOM study, accepted only by the dedicated study-upload endpoint.
DICOM_ZIP_MIME = "application/zip"
DICOM_MIMES = (DICOM_MIME, DICOM_ZIP_MIME)


class StudyStatus(models.TextChoices):
    PENDING = "pending", "قيد التجهيز"
    STORED = "stored", "جاهزة للعرض"
    FAILED = "failed", "تعذرت المعالجة"


class DicomStudy(BaseModel):
    document = models.OneToOneField("documents.ClinicalDocument", on_delete=models.PROTECT,
                                    related_name="dicom_study")
    status = models.CharField(max_length=10, choices=StudyStatus.choices,
                              default=StudyStatus.PENDING, db_index=True)
    # Machine-readable failure reason only (no PHI, no Orthanc response bodies).
    error_code = models.CharField(max_length=40, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    # The PatientID written into the Orthanc copy instead of the real one (ADR-030).
    pseudonym = models.CharField(max_length=64, blank=True)
    orthanc_study_id = models.CharField(max_length=64, blank=True, db_index=True)
    study_instance_uid = models.CharField(max_length=64, blank=True)
    modalities = models.CharField(max_length=60, blank=True)
    study_date = models.DateField(null=True, blank=True)
    study_description = models.CharField(max_length=200, blank=True)
    series_count = models.PositiveIntegerField(default=0)
    instance_count = models.PositiveIntegerField(default=0)
    stored_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "DICOM studies"


class DicomSeries(BaseModel):
    study = models.ForeignKey(DicomStudy, on_delete=models.CASCADE, related_name="series")
    orthanc_id = models.CharField(max_length=64)
    series_instance_uid = models.CharField(max_length=64, blank=True)
    modality = models.CharField(max_length=16, blank=True)
    number = models.IntegerField(null=True, blank=True)
    description = models.CharField(max_length=200, blank=True)
    instance_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("number", "created_at")
        constraints = [models.UniqueConstraint(fields=["study", "orthanc_id"],
                                               name="dicom_series_unique")]


class DicomInstance(BaseModel):
    series = models.ForeignKey(DicomSeries, on_delete=models.CASCADE, related_name="instances")
    orthanc_id = models.CharField(max_length=64)
    instance_number = models.IntegerField(null=True, blank=True)
    frames = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ("instance_number", "created_at")
        constraints = [models.UniqueConstraint(fields=["series", "orthanc_id"],
                                               name="dicom_instance_unique")]
        indexes = [models.Index(fields=["series", "instance_number"], name="dicom_inst_order")]
