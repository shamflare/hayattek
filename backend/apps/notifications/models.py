from django.conf import settings
from django.db import models

from apps.core.models import BaseModel


class NotificationKind(models.TextChoices):
    ACCESS_REQUEST = "access_request", "طلب وصول"
    ACCESS_GRANTED = "access_granted", "منح وصول"
    NEW_RECORD = "new_record", "سجل جديد"
    LAB_RESULT = "lab_result", "نتيجة تحليل"
    REFERRAL = "referral", "إحالة"
    INCOMING_ORDER = "incoming_order", "طلب وارد"
    SYSTEM = "system", "النظام"


class Notification(BaseModel):
    """In-app notification. Bodies stay generic: no diagnoses or results (they may show on
    lock screens once push is enabled)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    kind = models.CharField(max_length=20, choices=NotificationKind.choices)
    title = models.CharField(max_length=150)
    body = models.CharField(max_length=300, blank=True)
    link = models.CharField(max_length=300, blank=True)
    data = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["user", "read_at"])]


# ------------------------------------------------------------------ outbound messages (outbox)


class MessageChannel(models.TextChoices):
    SMS = "sms", "رسالة نصية"
    EMAIL = "email", "بريد إلكتروني"


class MessagePurpose(models.TextChoices):
    OTP = "otp", "رمز تحقق"
    ACCOUNT_ACTIVATION = "account_activation", "تفعيل حساب"
    PASSWORD_RESET = "password_reset", "استعادة كلمة المرور"
    NOTIFICATION = "notification", "إشعار"


class MessageStatus(models.TextChoices):
    QUEUED = "queued", "في الطابور"
    SENDING = "sending", "قيد الإرسال"
    SENT = "sent", "أُرسلت"
    FAILED = "failed", "فشلت"
    NOT_CONFIGURED = "not_configured", "خدمة الإرسال غير مفعلة"
    SUPPRESSED = "suppressed", "أوقفت (حد الإرسال)"


TERMINAL_MESSAGE_STATUSES = {MessageStatus.SENT, MessageStatus.FAILED,
                             MessageStatus.NOT_CONFIGURED, MessageStatus.SUPPRESSED}


class OutboundMessage(BaseModel):
    """Outbox row for one SMS/email. Minimal data: the destination and body are kept only
    while delivery is pending and are wiped on any terminal status (bodies can carry OTPs or
    one-time links). Rate limiting uses ``recipient_hash``; admins only see the mask."""

    channel = models.CharField(max_length=10, choices=MessageChannel.choices)
    purpose = models.CharField(max_length=24, choices=MessagePurpose.choices)
    to = models.CharField(max_length=254, blank=True)
    recipient_hash = models.CharField(max_length=64, db_index=True)
    recipient_masked = models.CharField(max_length=60)
    subject = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=MessageStatus.choices,
                              default=MessageStatus.QUEUED, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=5)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=200, blank=True)  # no PHI, no recipient
    provider = models.CharField(max_length=60, blank=True)
    provider_message_id = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=200, unique=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["recipient_hash", "created_at"], name="outbox_rcpt_time"),
                   models.Index(fields=["status", "next_attempt_at"], name="outbox_due")]
