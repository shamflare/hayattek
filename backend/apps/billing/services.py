"""Wallet services. All money moves go through `post_transaction` (row lock + ledger line +
cached balance in one DB transaction). See docs/POSTPAID_WALLET.md."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.audit import services as audit
from apps.core.exceptions import DomainError
from apps.core.ids import random_code
from apps.practitioners.models import Practitioner

from .models import (
    AIAccessEvent,
    AIScribeAccess,
    AIUsageRecord,
    Currency,
    LedgerTransaction,
    OrganizationPayerRule,
    OwnerType,
    PriceAssignment,
    PricingPlan,
    RoundingMode,
    TxKind,
    UsageStatus,
    WalletAccount,
)

CENT = Decimal("0.01")
ZERO = Decimal("0")


def money(value) -> Decimal:
    """Exact decimal money, rounded half-up to cents. Never accepts floats."""
    if isinstance(value, float):
        raise TypeError("Money must not be a float.")
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ wallets


def practitioner_wallet(practitioner: Practitioner, currency: str = Currency.USD) -> WalletAccount:
    wallet, _ = WalletAccount.objects.get_or_create(
        owner_type=OwnerType.PRACTITIONER, practitioner=practitioner, currency=currency)
    return wallet


def organization_wallet(organization, currency: str = Currency.USD) -> WalletAccount:
    wallet, _ = WalletAccount.objects.get_or_create(
        owner_type=OwnerType.ORGANIZATION, organization=organization, currency=currency)
    return wallet


def payer_wallet(practitioner: Practitioner, organization) -> WalletAccount:
    """Exactly one wallet pays for a session: the facility if it has an active payer rule,
    otherwise the doctor (default)."""
    if organization is not None and OrganizationPayerRule.objects.filter(
            organization=organization, is_active=True).exists():
        return organization_wallet(organization)
    return practitioner_wallet(practitioner)


def recompute_balance(wallet: WalletAccount) -> Decimal:
    total = wallet.transactions.aggregate(s=Sum("amount"))["s"]
    return money(total or ZERO)


@transaction.atomic
def post_transaction(wallet: WalletAccount, *, kind: str, amount: Decimal, actor=None,
                     occurred_at: datetime | None = None, description: str = "",
                     organization=None, payment_method: str = "", reference: str = "",
                     receipt_number: str | None = None, reverses: LedgerTransaction | None = None,
                     idempotency_key: str | None = None, request=None) -> LedgerTransaction:
    """Append one ledger line and update the cached balance atomically (row lock)."""
    amount = money(amount)
    if amount == ZERO:
        raise DomainError(_("لا يمكن تسجيل عملية بمبلغ صفر."), code="zero_amount")
    if idempotency_key:
        existing = LedgerTransaction.objects.filter(idempotency_key=idempotency_key).first()
        if existing is not None:
            return existing
    locked = WalletAccount.objects.select_for_update().get(pk=wallet.pk)
    new_balance = money(locked.balance + amount)
    try:
        with transaction.atomic():
            tx = LedgerTransaction.objects.create(
                wallet=locked, kind=kind, amount=amount, currency=locked.currency,
                balance_after=new_balance, occurred_at=occurred_at or timezone.now(),
                created_by=actor, organization=organization, description=description[:300],
                payment_method=payment_method, reference=reference[:100],
                receipt_number=receipt_number, reverses=reverses,
                idempotency_key=idempotency_key,
            )
    except IntegrityError:
        # Concurrent duplicate with the same idempotency key (or double reversal).
        if idempotency_key:
            existing = LedgerTransaction.objects.filter(idempotency_key=idempotency_key).first()
            if existing is not None:
                return existing
        raise DomainError(_("تم تسجيل هذه العملية مسبقاً."), code="duplicate_transaction",
                          status_code=409) from None
    locked.balance = new_balance
    locked.save(update_fields=["balance", "updated_at"])
    audit.record("billing.transaction", request=request, actor=actor, target=tx,
                 metadata={"kind": kind, "amount": str(amount), "wallet": str(locked.pk)})
    wallet.balance = new_balance
    return tx


# ------------------------------------------------------------------ payments & adjustments


def _receipt_number() -> str:
    return f"RC-{timezone.now():%y%m}-{random_code(6)}"


def record_payment(wallet: WalletAccount, *, amount, currency: str, paid_at: datetime | None,
                   method: str, reference: str = "", notes: str = "", actor, request=None,
                   idempotency_key: str | None = None) -> LedgerTransaction:
    amount = money(amount)
    if amount <= ZERO:
        raise DomainError(_("مبلغ الدفعة يجب أن يكون أكبر من صفر."), code="invalid_amount")
    if currency != wallet.currency:
        raise DomainError(_("عملة الدفعة لا تطابق عملة المحفظة."), code="currency_mismatch")
    for _attempt in range(3):
        try:
            return post_transaction(
                wallet, kind=TxKind.PAYMENT, amount=amount, actor=actor, occurred_at=paid_at,
                description=notes or _("دفعة مستلمة"), payment_method=method, reference=reference,
                receipt_number=_receipt_number(), idempotency_key=idempotency_key,
                request=request,
            )
        except DomainError as e:  # receipt number collision (astronomically rare)
            if e.get_codes() != "duplicate_transaction" or idempotency_key:
                raise
    raise DomainError(_("تعذر إصدار رقم إيصال."), code="receipt_collision")


ADJUSTMENT_SIGNS = {
    TxKind.MANUAL_DEBIT: -1,       # increases debt
    TxKind.CREDIT_GRANT: +1,       # free credit for the doctor
    TxKind.CHARGE_CORRECTION: +1,  # cancels part of a wrong charge
    TxKind.REFUND: -1,             # HayatTek pays money back → doctor's credit decreases
    TxKind.SETTLEMENT: 0,          # signed by the admin
}


def adjust(wallet: WalletAccount, *, kind: str, amount, reason: str, actor,
           occurred_at: datetime | None = None, request=None) -> LedgerTransaction:
    if kind not in ADJUSTMENT_SIGNS:
        raise DomainError(_("نوع تسوية غير معروف."), code="invalid_kind")
    if len((reason or "").strip()) < 3:
        raise DomainError(_("اكتب سبب التسوية."), code="reason_required")
    amount = money(amount)
    sign = ADJUSTMENT_SIGNS[kind]
    if sign == 0:
        if amount == ZERO:
            raise DomainError(_("المبلغ لا يمكن أن يكون صفراً."), code="invalid_amount")
    else:
        if amount <= ZERO:
            raise DomainError(_("أدخل المبلغ كقيمة موجبة؛ الإشارة تُحدد حسب نوع العملية."),
                              code="invalid_amount")
        amount = amount * sign
    return post_transaction(wallet, kind=kind, amount=amount, actor=actor,
                            occurred_at=occurred_at, description=reason, request=request)


def reverse_transaction(tx: LedgerTransaction, *, reason: str, actor, request=None
                        ) -> LedgerTransaction:
    """Post the exact opposite of `tx`. The original stays untouched; each line can be
    reversed once, and reversals themselves cannot be reversed (post a new entry instead)."""
    if len((reason or "").strip()) < 3:
        raise DomainError(_("اكتب سبب العكس."), code="reason_required")
    if tx.kind == TxKind.REVERSAL:
        raise DomainError(_("لا يمكن عكس عملية عكسية؛ سجّل عملية جديدة بدلاً من ذلك."),
                          code="cannot_reverse_reversal")
    if LedgerTransaction.objects.filter(reverses=tx).exists():
        raise DomainError(_("تم عكس هذه العملية مسبقاً."), code="already_reversed",
                          status_code=409)
    return post_transaction(
        tx.wallet, kind=TxKind.REVERSAL, amount=-tx.amount, actor=actor,
        description=f"{_('عكس')}: {reason}", reverses=tx, organization=tx.organization,
        idempotency_key=f"reverse:{tx.pk}", request=request,
    )


# ------------------------------------------------------------------ pricing


def default_plan() -> PricingPlan:
    plan = PricingPlan.objects.filter(is_default=True, is_active=True).first()
    if plan is None:
        plan, _ = PricingPlan.objects.get_or_create(
            code="default", defaults={"name": "السعر الافتراضي", "price_per_minute": Decimal("0.10"),
                                      "is_default": True})
    return plan


def plan_for(practitioner: Practitioner, at: datetime | None = None) -> PricingPlan:
    at = at or timezone.now()
    assignment = (PriceAssignment.objects.filter(practitioner=practitioner, effective_from__lte=at,
                                                 plan__is_active=True)
                  .select_related("plan").order_by("-effective_from", "-created_at").first())
    return assignment.plan if assignment else default_plan()


def billable_seconds(audio_seconds: int, plan: PricingPlan) -> int:
    seconds = max(int(audio_seconds), plan.minimum_billable_seconds)
    if seconds <= 0:
        return 0
    step = {RoundingMode.CEIL_MINUTE: 60, RoundingMode.CEIL_HALF_MINUTE: 30}.get(
        plan.rounding_mode, 1)
    return int((Decimal(seconds) / step).to_integral_value(rounding=ROUND_CEILING)) * step


def price(audio_seconds: int, plan: PricingPlan) -> tuple[int, Decimal]:
    seconds = billable_seconds(audio_seconds, plan)
    amount = money(Decimal(seconds) / Decimal(60) * plan.price_per_minute)
    return seconds, amount


def assign_plan(practitioner: Practitioner, plan: PricingPlan, *, actor,
                effective_from: datetime | None = None, request=None) -> PriceAssignment:
    assignment = PriceAssignment.objects.create(
        practitioner=practitioner, plan=plan, effective_from=effective_from or timezone.now(),
        assigned_by=actor)
    audit.record("billing.price_assigned", request=request, actor=actor, target=assignment,
                 metadata={"plan": plan.code, "price_per_minute": str(plan.price_per_minute)})
    return assignment


def set_custom_rate(practitioner: Practitioner, price_per_minute, *, actor, request=None,
                    rounding_mode: str = RoundingMode.CEIL_MINUTE) -> PriceAssignment:
    """Admin shortcut: a personal plan for one doctor, effective now."""
    rate = Decimal(str(price_per_minute))
    if rate < ZERO:
        raise DomainError(_("السعر لا يمكن أن يكون سالباً."), code="invalid_price")
    plan = PricingPlan.objects.create(
        code=f"custom-{practitioner.pk.hex[:10]}-{random_code(4).lower()}",
        name=f"سعر خاص — {practitioner.display_name}", price_per_minute=rate,
        rounding_mode=rounding_mode)
    return assign_plan(practitioner, plan, actor=actor, request=request)


# ------------------------------------------------------------------ AI access (manual only)


def ai_enabled(practitioner: Practitioner) -> bool:
    """THE gate for starting AI sessions. Intentionally ignores balance and debt."""
    access = AIScribeAccess.objects.filter(practitioner=practitioner).first()
    return bool(access and access.enabled)


@transaction.atomic
def set_ai_access(practitioner: Practitioner, *, enabled: bool, actor, reason: str = "",
                  request=None) -> AIScribeAccess:
    access, _ = AIScribeAccess.objects.select_for_update().get_or_create(practitioner=practitioner)
    access.enabled = enabled
    access.changed_by = actor
    access.changed_at = timezone.now()
    access.reason = reason[:300]
    access.save()
    AIAccessEvent.objects.create(practitioner=practitioner, enabled=enabled, changed_by=actor,
                                 reason=reason[:300])
    audit.record("billing.ai_access", request=request, actor=actor, target=access,
                 metadata={"enabled": enabled})
    return access


# ------------------------------------------------------------------ AI usage metering


@dataclass
class ChargeResult:
    usage: AIUsageRecord
    created: bool


@transaction.atomic
def charge_ai_session(*, session_id, practitioner: Practitioner, organization,
                      audio_seconds: int, provider_cost: Decimal = ZERO,
                      provider_cost_is_actual: bool = False) -> ChargeResult:
    """Bill one successful session exactly once (UNIQUE session_id + ledger idempotency key).

    Safe to call again after retries, duplicate callbacks or task restarts.
    """
    existing = AIUsageRecord.objects.select_for_update().filter(session_id=session_id).first()
    if existing is not None and existing.status == UsageStatus.CHARGED:
        return ChargeResult(existing, False)

    plan = plan_for(practitioner)
    seconds, amount = price(audio_seconds, plan)
    wallet = existing.wallet if existing else payer_wallet(practitioner, organization)
    tx = None
    if amount > ZERO:
        tx = post_transaction(
            wallet, kind=TxKind.AI_USAGE, amount=-amount, organization=organization,
            description=_("استهلاك المساعد الذكي — %(m)s دقيقة") % {
                "m": (Decimal(seconds) / 60).quantize(Decimal("0.01"))},
            idempotency_key=f"ai:{session_id}",
        )
    values = {
        "practitioner": practitioner, "organization": organization, "wallet": wallet,
        "status": UsageStatus.CHARGED, "audio_seconds": audio_seconds,
        "billable_seconds": seconds, "plan": plan, "plan_name": plan.name,
        "price_per_minute": plan.price_per_minute, "rounding_mode": plan.rounding_mode,
        "currency": wallet.currency, "billed_amount": amount, "transaction": tx,
    }
    if existing is None:
        try:
            with transaction.atomic():
                usage = AIUsageRecord.objects.create(
                    session_id=session_id, provider_cost=provider_cost,
                    provider_cost_is_actual=provider_cost_is_actual, **values)
        except IntegrityError:  # a concurrent call won the race
            return ChargeResult(AIUsageRecord.objects.get(session_id=session_id), False)
        return ChargeResult(usage, True)
    for key, value in values.items():
        setattr(existing, key, value)
    existing.provider_cost = existing.provider_cost + provider_cost
    existing.provider_cost_is_actual = existing.provider_cost_is_actual and provider_cost_is_actual
    existing.save()
    return ChargeResult(existing, True)


@transaction.atomic
def record_failed_session(*, session_id, practitioner: Practitioner, organization,
                          provider_cost: Decimal = ZERO, provider_cost_is_actual=False
                          ) -> AIUsageRecord:
    """No charge for the doctor, but keep what the provider cost us."""
    usage = AIUsageRecord.objects.select_for_update().filter(session_id=session_id).first()
    if usage is None:
        return AIUsageRecord.objects.create(
            session_id=session_id, practitioner=practitioner, organization=organization,
            wallet=payer_wallet(practitioner, organization), status=UsageStatus.NOT_BILLABLE,
            provider_cost=provider_cost, provider_cost_is_actual=provider_cost_is_actual)
    if usage.status != UsageStatus.CHARGED:
        usage.provider_cost = usage.provider_cost + provider_cost
        usage.save(update_fields=["provider_cost", "updated_at"])
    return usage
