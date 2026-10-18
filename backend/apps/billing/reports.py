"""Aggregates for the admin wallet dashboard. Informational only: nothing here can disable
or restrict a doctor's AI access (docs/POSTPAID_WALLET.md §Alerts)."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, DecimalField, Max, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.practitioners.models import Practitioner

from .models import (
    AIScribeAccess,
    AIUsageRecord,
    BillingSettings,
    LedgerTransaction,
    OwnerType,
    TxKind,
    UsageStatus,
    WalletAccount,
)
from .services import ZERO, money, plan_for

DEC = DecimalField(max_digits=14, decimal_places=2)
DEC6 = DecimalField(max_digits=18, decimal_places=6)


def overview() -> dict:
    wallets = WalletAccount.objects.filter(owner_type=OwnerType.PRACTITIONER)
    agg = wallets.aggregate(
        total_balance=Coalesce(Sum("balance"), Value(ZERO), output_field=DEC),
        total_debt=Coalesce(Sum("balance", filter=Q(balance__lt=0)), Value(ZERO), output_field=DEC),
        debtors=Count("id", filter=Q(balance__lt=0)),
        creditors=Count("id", filter=Q(balance__gt=0)),
    )
    payments = LedgerTransaction.objects.filter(kind=TxKind.PAYMENT).aggregate(
        s=Coalesce(Sum("amount"), Value(ZERO), output_field=DEC))["s"]
    reversed_payments = LedgerTransaction.objects.filter(
        kind=TxKind.REVERSAL, reverses__kind=TxKind.PAYMENT).aggregate(
        s=Coalesce(Sum("amount"), Value(ZERO), output_field=DEC))["s"]
    usage = AIUsageRecord.objects.aggregate(
        revenue=Coalesce(Sum("billed_amount", filter=Q(status=UsageStatus.CHARGED)),
                         Value(ZERO), output_field=DEC),
        cost=Coalesce(Sum("provider_cost"), Value(ZERO), output_field=DEC6),
        sessions=Count("id", filter=Q(status=UsageStatus.CHARGED)),
        failed=Count("id", filter=Q(status=UsageStatus.NOT_BILLABLE)),
    )
    return {
        "currency": "USD",
        "total_balance": money(agg["total_balance"]),
        "total_debt": money(-agg["total_debt"]),
        "total_collected": money(payments + reversed_payments),
        "debtor_count": agg["debtors"],
        "creditor_count": agg["creditors"],
        "ai_revenue": money(usage["revenue"]),
        "provider_cost": money(usage["cost"]),
        "margin": money(usage["revenue"] - usage["cost"]),
        "billed_sessions": usage["sessions"],
        "failed_sessions": usage["failed"],
    }


def practitioner_rows(q: str = "", status: str = "", ai: str = "", ordering: str = "") -> list[dict]:
    practitioners = Practitioner.objects.filter(verification_status="verified").select_related("user")
    if q:
        practitioners = practitioners.filter(display_name__icontains=q)
    wallets = {w.practitioner_id: w for w in WalletAccount.objects.filter(
        owner_type=OwnerType.PRACTITIONER, practitioner__in=practitioners)}
    tx_stats = {r["wallet__practitioner_id"]: r for r in LedgerTransaction.objects.filter(
        wallet__practitioner__in=practitioners).values("wallet__practitioner_id").annotate(
        charges=Coalesce(Sum("amount", filter=Q(kind=TxKind.AI_USAGE)), Value(ZERO), output_field=DEC),
        payments=Coalesce(Sum("amount", filter=Q(kind=TxKind.PAYMENT)), Value(ZERO), output_field=DEC),
        last_payment=Max("occurred_at", filter=Q(kind=TxKind.PAYMENT)),
    )}
    sessions = dict(AIUsageRecord.objects.filter(practitioner__in=practitioners,
                                                 status=UsageStatus.CHARGED)
                    .values("practitioner_id").annotate(n=Count("id")).values_list("practitioner_id", "n"))
    access = dict(AIScribeAccess.objects.filter(practitioner__in=practitioners)
                  .values_list("practitioner_id", "enabled"))
    rows = []
    for p in practitioners:
        wallet = wallets.get(p.pk)
        balance = wallet.balance if wallet else ZERO
        stats = tx_stats.get(p.pk, {})
        orgs = [m.organization.name for m in p.user.memberships.filter(status="active")
                .select_related("organization")]
        rows.append({
            "practitioner_id": str(p.pk), "name": p.display_name, "specialty": p.specialty,
            "organizations": orgs, "price_per_minute": plan_for(p).price_per_minute,
            "sessions": sessions.get(p.pk, 0),
            "total_charges": money(-(stats.get("charges") or ZERO)),
            "total_payments": money(stats.get("payments") or ZERO),
            "balance": money(balance), "debt": money(-balance if balance < 0 else ZERO),
            "last_payment_at": stats.get("last_payment"),
            "ai_enabled": bool(access.get(p.pk, False)),
        })
    if status == "debtor":
        rows = [r for r in rows if r["balance"] < 0]
    elif status == "creditor":
        rows = [r for r in rows if r["balance"] > 0]
    elif status == "zero":
        rows = [r for r in rows if r["balance"] == 0]
    if ai in ("on", "off"):
        rows = [r for r in rows if r["ai_enabled"] == (ai == "on")]
    key = (ordering or "-debt").lstrip("-")
    if rows and key in rows[0]:
        rows.sort(key=lambda r: (r[key] is None, r[key] if r[key] is not None else 0),
                  reverse=ordering.startswith("-") or not ordering)
    return rows


def wallet_summary(wallet: WalletAccount | None, practitioner: Practitioner, *,
                   include_internal: bool) -> dict:
    """Cards for one wallet. `include_internal` adds provider cost / margin (admins only)."""
    txs = wallet.transactions if wallet else LedgerTransaction.objects.none()
    sums = txs.aggregate(
        charges=Coalesce(Sum("amount", filter=Q(kind=TxKind.AI_USAGE)), Value(ZERO), output_field=DEC),
        payments=Coalesce(Sum("amount", filter=Q(kind=TxKind.PAYMENT)), Value(ZERO), output_field=DEC),
        last_payment=Max("occurred_at", filter=Q(kind=TxKind.PAYMENT)),
    )
    usage = AIUsageRecord.objects.filter(practitioner=practitioner, status=UsageStatus.CHARGED)
    uagg = usage.aggregate(seconds=Coalesce(Sum("billable_seconds"), Value(0)),
                           n=Count("id"), cost=Coalesce(Sum("provider_cost"), Value(ZERO),
                                                        output_field=DEC6))
    plan = plan_for(practitioner)
    balance = wallet.balance if wallet else ZERO
    data = {
        "practitioner_id": str(practitioner.pk), "name": practitioner.display_name,
        "specialty": practitioner.specialty, "currency": wallet.currency if wallet else "USD",
        "balance": money(balance), "amount_due": money(-balance if balance < 0 else ZERO),
        "total_charges": money(-sums["charges"]), "total_payments": money(sums["payments"]),
        "last_payment_at": sums["last_payment"], "sessions": uagg["n"],
        "billable_minutes": (Decimal(uagg["seconds"]) / 60).quantize(Decimal("0.01")),
        "price_per_minute": plan.price_per_minute, "plan_name": plan.name,
        "rounding_mode": plan.rounding_mode,
        "ai_enabled": AIScribeAccess.objects.filter(practitioner=practitioner, enabled=True).exists(),
    }
    if include_internal:
        data["provider_cost"] = money(uagg["cost"])
        data["margin"] = money(-sums["charges"] - uagg["cost"])
    return data


def alerts() -> list[dict]:
    """Informational alerts. They are displayed; they never disable anything."""
    cfg = BillingSettings.load()
    out: list[dict] = []
    now = timezone.now()
    for w in WalletAccount.objects.filter(owner_type=OwnerType.PRACTITIONER,
                                          balance__lte=-cfg.doctor_debt_alert).select_related("practitioner"):
        out.append({"kind": "doctor_debt", "severity": "warning", "practitioner_id": str(w.practitioner_id),
                    "message": f"مديونية {w.practitioner.display_name} بلغت {money(-w.balance)} $"})
    total_debt = -(WalletAccount.objects.filter(balance__lt=0).aggregate(
        s=Coalesce(Sum("balance"), Value(ZERO), output_field=DEC))["s"])
    if total_debt >= cfg.total_debt_alert:
        out.append({"kind": "total_debt", "severity": "warning", "practitioner_id": None,
                    "message": f"إجمالي المديونية {money(total_debt)} $ تجاوز الحد المحدد"})
    month_cost = AIUsageRecord.objects.filter(created_at__gte=now - timedelta(days=30)).aggregate(
        s=Coalesce(Sum("provider_cost"), Value(ZERO), output_field=DEC6))["s"]
    if month_cost >= cfg.monthly_provider_cost_alert:
        out.append({"kind": "provider_cost", "severity": "warning", "practitioner_id": None,
                    "message": f"تكلفة مزود الذكاء الاصطناعي آخر 30 يوماً: {money(month_cost)} $"})
    # Usage spike: last 7 days vs the previous 4-week weekly average.
    week = now - timedelta(days=7)
    base_start = now - timedelta(days=35)
    recent = dict(AIUsageRecord.objects.filter(created_at__gte=week, status=UsageStatus.CHARGED)
                  .values("practitioner_id").annotate(s=Sum("billable_seconds"))
                  .values_list("practitioner_id", "s"))
    base = dict(AIUsageRecord.objects.filter(created_at__gte=base_start, created_at__lt=week,
                                             status=UsageStatus.CHARGED)
                .values("practitioner_id").annotate(s=Sum("billable_seconds"))
                .values_list("practitioner_id", "s"))
    names = dict(Practitioner.objects.filter(pk__in=recent).values_list("pk", "display_name"))
    for pid, seconds in recent.items():
        weekly_avg = Decimal(base.get(pid, 0)) / 4
        if weekly_avg > 0 and Decimal(seconds) > weekly_avg * cfg.usage_spike_factor:
            out.append({"kind": "usage_spike", "severity": "info", "practitioner_id": str(pid),
                        "message": f"استهلاك {names.get(pid)} هذا الأسبوع أعلى من المعتاد"})
    # Overdue: in debt and no payment for N days.
    cutoff = now - timedelta(days=cfg.overdue_days)
    for w in WalletAccount.objects.filter(owner_type=OwnerType.PRACTITIONER, balance__lt=0) \
            .select_related("practitioner"):
        last = w.transactions.filter(kind=TxKind.PAYMENT).aggregate(m=Max("occurred_at"))["m"]
        first_debt = w.transactions.filter(amount__lt=0).aggregate(m=Max("occurred_at"))["m"]
        reference = last or first_debt
        if reference and reference < cutoff:
            out.append({"kind": "overdue", "severity": "info", "practitioner_id": str(w.practitioner_id),
                        "message": f"لا توجد دفعة من {w.practitioner.display_name} منذ أكثر من "
                                   f"{cfg.overdue_days} يوماً"})
    return out

