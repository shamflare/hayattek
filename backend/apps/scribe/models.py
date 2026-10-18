"""HayatTek AI — the medical scribe (docs/AI_SCRIBE.md).

A session belongs to one draft encounter written by one doctor in one facility. The audio is
stored encrypted; the transcript and the structured draft are suggestions until the doctor
reviews and approves them. Billing is metered in apps.billing (one charge per session).
"""

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel


class ScribeMode(models.TextChoices):
    CONVERSATION = "conversation", "الاستماع الذكي (حوار)"
    DICTATION = "dictation", "الإملاء الطبي الذكي"


class SessionStatus(models.TextChoices):
    CREATED = "created", "بانتظار التسجيل"
    UPLOADED = "uploaded", "رُفع التسجيل"
    PROCESSING = "processing", "قيد المعالجة"
    READY = "ready", "المسودة جاهزة للمراجعة"
    APPROVED = "approved", "اعتمدها الطبيب"
    FAILED = "failed", "فشلت المعالجة"
    DISCARDED = "discarded", "أُلغيت"


class ConsentMethod(models.TextChoices):
    VERBAL = "verbal", "موافقة شفهية أمام الطبيب"
    WRITTEN = "written", "موافقة مكتوبة"
    NOT_REQUIRED = "not_required", "غير مطلوبة (إملاء الطبيب وحده)"


class ScribeSession(BaseModel):
    encounter = models.ForeignKey("clinical.Encounter", on_delete=models.PROTECT,
                                  related_name="scribe_sessions")
    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    organization = models.ForeignKey("organizations.Organization", on_delete=models.PROTECT,
                                     related_name="+")
    practitioner = models.ForeignKey("practitioners.Practitioner", on_delete=models.PROTECT,
                                     related_name="scribe_sessions")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                               related_name="+")
    mode = models.CharField(max_length=16, choices=ScribeMode.choices)
    status = models.CharField(max_length=12, choices=SessionStatus.choices,
                              default=SessionStatus.CREATED, db_index=True)
    client_key = models.CharField(max_length=64, help_text="Client idempotency key for start.")

    consent_method = models.CharField(max_length=16, choices=ConsentMethod.choices)
    consent_note = models.CharField(max_length=300, blank=True)
    consent_at = models.DateTimeField()

    audio_file = models.FileField(upload_to="scribe-audio/", max_length=300, blank=True)
    audio_sha256 = models.CharField(max_length=64, blank=True)
    audio_seconds = models.PositiveIntegerField(default=0)
    audio_bytes = models.PositiveIntegerField(default=0)
    audio_is_sample = models.BooleanField(default=False)
    audio_deleted_at = models.DateTimeField(null=True, blank=True)
    retention_until = models.DateTimeField(null=True, blank=True)

    transcript = models.JSONField(default=dict, blank=True)
    draft = models.JSONField(default=dict, blank=True)
    stt_provider = models.CharField(max_length=60, blank=True)
    extraction_provider = models.CharField(max_length=60, blank=True)
    is_mock = models.BooleanField(default=False)
    attempts = models.PositiveSmallIntegerField(default=0)
    error_code = models.CharField(max_length=40, blank=True)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.PROTECT, related_name="+")
    applied = models.JSONField(default=dict, blank=True,
                               help_text="What the doctor applied to the record on approval.")

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["practitioner", "client_key"],
                                    name="uniq_scribe_client_key"),
            models.CheckConstraint(
                condition=~Q(mode="conversation", consent_method="not_required"),
                name="conversation_requires_patient_consent"),
        ]
        indexes = [models.Index(fields=["encounter", "-created_at"], name="scribe_enc_time")]
