from django.db import models

from apps.core.ids import uuid7


class AuditOutcome(models.TextChoices):
    SUCCESS = "success", "نجاح"
    DENIED = "denied", "مرفوض"
    FAILURE = "failure", "فشل"


class AuditEvent(models.Model):
    """Append-only security log (ADR-008).

    Uses plain UUID columns instead of foreign keys on purpose: audit rows must
    survive any cascade and never be rewritten. UPDATE/DELETE are blocked by a
    PostgreSQL trigger (see migration 0002). Never store PHI here.
    """

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    occurred_at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor_id = models.UUIDField(null=True, blank=True, db_index=True)
    membership_id = models.UUIDField(null=True, blank=True)
    organization_id = models.UUIDField(null=True, blank=True, db_index=True)
    action = models.CharField(max_length=64, db_index=True)
    outcome = models.CharField(
        max_length=16, choices=AuditOutcome.choices, default=AuditOutcome.SUCCESS
    )
    target_type = models.CharField(max_length=64, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    patient_id = models.UUIDField(null=True, blank=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=256, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-occurred_at",)
        indexes = [models.Index(fields=["patient_id", "-occurred_at"])]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("AuditEvent rows are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("AuditEvent rows are immutable.")
