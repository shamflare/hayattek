from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.access.models import Scope
from apps.clinical.base import ClinicalRecord


class ReferralPriority(models.TextChoices):
    ROUTINE = "routine", "عادية"
    URGENT = "urgent", "عاجلة"
    EMERGENCY = "emergency", "إسعافية"


class ReferralState(models.TextChoices):
    SENT = "sent", "مرسلة"
    ACCEPTED = "accepted", "مقبولة"
    DECLINED = "declined", "مرفوضة"
    COMPLETED = "completed", "مكتملة"
    CANCELLED = "cancelled", "ملغاة"


class Referral(ClinicalRecord):
    """Referral to another practitioner/organization. Sharing is limited to `shared_scopes`
    and only applied when the patient consented (§13)."""

    SCOPE = "referrals"

    encounter = models.ForeignKey(
        "clinical.Encounter", null=True, blank=True, on_delete=models.PROTECT,
        related_name="referrals",
    )
    target_organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT,
        related_name="incoming_referrals",
    )
    target_practitioner = models.ForeignKey(
        "practitioners.Practitioner", null=True, blank=True, on_delete=models.PROTECT,
        related_name="incoming_referrals",
    )
    target_specialty = models.CharField(max_length=40, blank=True)
    reason = models.TextField()
    priority = models.CharField(
        max_length=10, choices=ReferralPriority.choices, default=ReferralPriority.ROUTINE
    )
    shared_scopes = ArrayField(
        models.CharField(max_length=20, choices=Scope.choices), default=list, blank=True
    )
    patient_consented = models.BooleanField(default=False)
    state = models.CharField(
        max_length=10, choices=ReferralState.choices, default=ReferralState.SENT
    )
    response_note = models.TextField(blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
