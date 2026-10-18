"""Postpaid doctor wallets (docs/POSTPAID_WALLET.md).

Golden rules:
  * Balance sign: positive = credit owed to the doctor, negative = the doctor owes HayatTek.
  * The ledger is append-only (DB trigger). Corrections are new, opposite transactions.
  * `WalletAccount.balance` is a cache; it must always equal the sum of its transactions
    (`services.recompute_balance`).
  * Debt NEVER disables the AI scribe. Only `AIScribeAccess.enabled`, changed manually by a
    platform admin, gates it.
"""

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.ids import uuid7
from apps.core.models import BaseModel

MONEY = {"max_digits": 14, "decimal_places": 2}
RATE = {"max_digits": 12, "decimal_places": 4}


class Currency(models.TextChoices):
    USD = "USD", "دولار أمريكي"


class OwnerType(models.TextChoices):
    PRACTITIONER = "practitioner", "طبيب"
    ORGANIZATION = "organization", "منشأة"


class WalletAccount(BaseModel):
    """One wallet per (owner, currency). Organizations may own one for a future
    'facility pays' arrangement; a usage record is billed to exactly one wallet."""

    owner_type = models.CharField(max_length=16, choices=OwnerType.choices)
    practitioner = models.ForeignKey(
        "practitioners.Practitioner", null=True, blank=True, on_delete=models.PROTECT,
        related_name="wallets",
    )
    organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT,
        related_name="wallets",
    )
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    balance = models.DecimalField(default=Decimal("0"), **MONEY)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(Q(owner_type="practitioner", practitioner__isnull=False,
                             organization__isnull=True)
                           | Q(owner_type="organization", organization__isnull=False,
                               practitioner__isnull=True)),
                name="wallet_single_owner",
            ),
            models.UniqueConstraint(fields=["practitioner", "currency"],
                                    condition=Q(practitioner__isnull=False),
                                    name="uniq_practitioner_wallet"),
            models.UniqueConstraint(fields=["organization", "currency"],
                                    condition=Q(organization__isnull=False),
                                    name="uniq_organization_wallet"),
        ]

    def __str__(self) -> str:
        owner = self.practitioner or self.organization
        return f"{owner} ({self.currency})"


class TxKind(models.TextChoices):
    AI_USAGE = "ai_usage", "استهلاك الذكاء الاصطناعي"
    PAYMENT = "payment", "دفعة"
    REVERSAL = "reversal", "عكس عملية"
    MANUAL_DEBIT = "manual_debit", "خصم يدوي"
    CREDIT_GRANT = "credit_grant", "رصيد مجاني"
    CHARGE_CORRECTION = "charge_correction", "تصحيح رسوم"
    SETTLEMENT = "settlement", "تسوية مالية"
    REFUND = "refund", "استرداد مبلغ"


class PaymentMethod(models.TextChoices):
    CASH = "cash", "نقداً"
    BANK_TRANSFER = "bank_transfer", "تحويل مصرفي"
    MONEY_TRANSFER = "money_transfer", "حوالة"
    OTHER = "other", "أخرى"


class LedgerTransaction(models.Model):
    """Immutable ledger line. `amount` is signed: + credits the wallet, − debits it."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    wallet = models.ForeignKey(WalletAccount, on_delete=models.PROTECT,
                               related_name="transactions")
    kind = models.CharField(max_length=20, choices=TxKind.choices)
    amount = models.DecimalField(**MONEY)
    currency = models.CharField(max_length=3, choices=Currency.choices)
    balance_after = models.DecimalField(**MONEY)
    occurred_at = models.DateTimeField(help_text="Business date (e.g. date the cash was received).")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.PROTECT, related_name="+")
    organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.PROTECT,
        related_name="+", help_text="Facility in whose context the usage happened.",
    )
    description = models.CharField(max_length=300, blank=True)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, blank=True)
    reference = models.CharField(max_length=100, blank=True)
    receipt_number = models.CharField(max_length=24, unique=True, null=True, blank=True)
    reverses = models.OneToOneField(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="reversed_by",
        help_text="A transaction can be reversed at most once.",
    )
    idempotency_key = models.CharField(max_length=120, unique=True, null=True, blank=True)

    class Meta:
        ordering = ("created_at",)
        indexes = [models.Index(fields=["wallet", "created_at"], name="ledger_wallet_time")]
        constraints = [
            models.CheckConstraint(condition=~Q(amount=0), name="ledger_amount_not_zero"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.amount} {self.currency}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Ledger transactions are immutable; post a reversal instead.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Ledger transactions are immutable; post a reversal instead.")


class RoundingMode(models.TextChoices):
    PER_SECOND = "per_second", "بالثانية"
    CEIL_MINUTE = "ceil_minute", "تقريب للأعلى لكل دقيقة"
    CEIL_HALF_MINUTE = "ceil_half_minute", "تقريب للأعلى لكل نصف دقيقة"


class PricingPlan(BaseModel):
    """A price list. Changing a plan never touches past usage: each usage stores a snapshot."""

    code = models.SlugField(unique=True)
    name = models.CharField(max_length=120)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    price_per_minute = models.DecimalField(**RATE)
    rounding_mode = models.CharField(max_length=20, choices=RoundingMode.choices,
                                     default=RoundingMode.CEIL_MINUTE)
    minimum_billable_seconds = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    notes = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=["is_default"], condition=Q(is_default=True),
                                    name="single_default_plan"),
            models.CheckConstraint(condition=Q(price_per_minute__gte=0), name="plan_price_gte_0"),
        ]

    def __str__(self) -> str:
        return self.name


class PriceAssignment(BaseModel):
    """Which plan applies to a doctor from `effective_from` (latest wins)."""

    practitioner = models.ForeignKey("practitioners.Practitioner", on_delete=models.CASCADE,
                                     related_name="price_assignments")
    plan = models.ForeignKey(PricingPlan, on_delete=models.PROTECT, related_name="assignments")
    effective_from = models.DateTimeField()
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                    on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ("-effective_from",)


class UsageStatus(models.TextChoices):
    CHARGED = "charged", "مفوتر"
    NOT_BILLABLE = "not_billable", "غير مفوتر (فشل)"


class AIUsageRecord(BaseModel):
    """Metering for one AI scribe session. UNIQUE per session → it is charged at most once."""

    session_id = models.UUIDField(unique=True)
    practitioner = models.ForeignKey("practitioners.Practitioner", on_delete=models.PROTECT,
                                     related_name="ai_usage")
    organization = models.ForeignKey("organizations.Organization", null=True, blank=True,
                                     on_delete=models.PROTECT, related_name="+")
    wallet = models.ForeignKey(WalletAccount, on_delete=models.PROTECT, related_name="usage")
    status = models.CharField(max_length=16, choices=UsageStatus.choices)
    audio_seconds = models.PositiveIntegerField(default=0)
    billable_seconds = models.PositiveIntegerField(default=0)
    # Price snapshot (never recomputed from the current plan).
    plan = models.ForeignKey(PricingPlan, null=True, on_delete=models.PROTECT, related_name="+")
    plan_name = models.CharField(max_length=120, blank=True)
    price_per_minute = models.DecimalField(default=Decimal("0"), **RATE)
    rounding_mode = models.CharField(max_length=20, choices=RoundingMode.choices, blank=True)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    billed_amount = models.DecimalField(default=Decimal("0"), **MONEY)
    # Internal economics (never shown to doctors).
    provider_cost = models.DecimalField(default=Decimal("0"), max_digits=12, decimal_places=6)
    provider_cost_is_actual = models.BooleanField(
        default=False, help_text="False = estimate from the provider's public price list.")
    transaction = models.OneToOneField(LedgerTransaction, null=True, blank=True,
                                       on_delete=models.PROTECT, related_name="usage")

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["practitioner", "-created_at"], name="usage_pract_time")]

    @property
    def margin(self) -> Decimal:
        return self.billed_amount - self.provider_cost


class AIScribeAccess(BaseModel):
    """The ONLY switch that allows or blocks new AI sessions for a doctor (manual, admin)."""

    practitioner = models.OneToOneField("practitioners.Practitioner", on_delete=models.CASCADE,
                                        related_name="ai_access")
    enabled = models.BooleanField(default=False)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")
    changed_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=300, blank=True)


class AIAccessEvent(BaseModel):
    """History of manual enable/disable decisions (who, when, why)."""

    practitioner = models.ForeignKey("practitioners.Practitioner", on_delete=models.CASCADE,
                                     related_name="ai_access_events")
    enabled = models.BooleanField()
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                   on_delete=models.SET_NULL, related_name="+")
    reason = models.CharField(max_length=300, blank=True)


class OrganizationPayerRule(BaseModel):
    """Future: a facility pays its doctors' AI usage instead of the doctors. Inactive by
    default. When active, usage in that facility is billed ONLY to the facility wallet."""

    organization = models.OneToOneField("organizations.Organization", on_delete=models.CASCADE,
                                        related_name="ai_payer_rule")
    is_active = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True,
                                   on_delete=models.SET_NULL, related_name="+")


class BillingSettings(models.Model):
    """Singleton with informational alert thresholds. Alerts never disable anything."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    doctor_debt_alert = models.DecimalField(default=Decimal("200"), **MONEY)
    total_debt_alert = models.DecimalField(default=Decimal("5000"), **MONEY)
    monthly_provider_cost_alert = models.DecimalField(default=Decimal("500"), **MONEY)
    usage_spike_factor = models.DecimalField(default=Decimal("3"), max_digits=6,
                                             decimal_places=2)
    overdue_days = models.PositiveIntegerField(default=30)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return "Billing settings"

    @classmethod
    def load(cls) -> "BillingSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
