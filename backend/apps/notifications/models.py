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
