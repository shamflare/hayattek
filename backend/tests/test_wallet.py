"""Postpaid wallet — the 17 scenarios of PHASE2_REQUIREMENTS §38 plus ledger integrity.

Real wallet logic and real PostgreSQL; synthetic usage only.
"""

import threading
import uuid
from decimal import Decimal

import pytest
from django.db import DatabaseError, connection, transaction

from apps.billing import services
from apps.billing.models import AIUsageRecord, LedgerTransaction, PricingPlan, TxKind
from apps.organizations.models import Role
from tests.conftest import Actor

pytestmark = pytest.mark.django_db

D = Decimal


def _charge(practitioner, amount_usd, organization=None, session=None):
    """Synthetic AI usage worth exactly `amount_usd` at 1 USD/minute."""
    plan, _ = PricingPlan.objects.get_or_create(
        code="test-1usd", defaults={"name": "test", "price_per_minute": D("1.00")})
    services.assign_plan(practitioner, plan, actor=None)
    return services.charge_ai_session(
        session_id=session or uuid.uuid4(), practitioner=practitioner, organization=organization,
        audio_seconds=int(D(amount_usd) * 60))


@pytest.fixture
def doc_p(doctor):
    return doctor.user.practitioner


def _balance(practitioner):
    wallet = services.practitioner_wallet(practitioner)
    wallet.refresh_from_db()
    assert wallet.balance == services.recompute_balance(wallet), "cache must equal ledger"
    return wallet.balance


# 1
def test_zero_balance_usage_of_10_gives_minus_10(doc_p):
    _charge(doc_p, 10)
    assert _balance(doc_p) == D("-10.00")


# 2 & 3
@pytest.mark.parametrize(("paid", "expected"), [(100, D("-100.00")), (250, D("50.00"))])
def test_payments_reduce_debt_or_create_credit(doc_p, platform_admin, paid, expected):
    _charge(doc_p, 200)
    r = platform_admin.post(f"/api/v1/billing/admin/practitioners/{doc_p.pk}/payments",
                            {"amount": str(paid), "currency": "USD", "method": "cash"})
    assert r.status_code == 201, r.data
    assert D(r.data["balance"]) == expected
    assert D(r.data["amount_due"]) == (-expected if expected < 0 else D("0"))
    assert _balance(doc_p) == expected
    assert r.data["transaction"]["receipt_number"].startswith("RC-")


# 4 & 5
def test_usage_continues_with_large_debt_no_auto_disable(doc_p, platform_admin):
    services.set_ai_access(doc_p, enabled=True, actor=platform_admin.user)
    for _ in range(10):
        _charge(doc_p, 100)
    assert _balance(doc_p) == D("-1000.00")
    assert services.ai_enabled(doc_p) is True  # never blocked by debt
    _charge(doc_p, 5)
    assert _balance(doc_p) == D("-1005.00")
    # Alerts are informational and change nothing.
    alerts = platform_admin.get("/api/v1/billing/admin/alerts").data
    assert any(a["kind"] == "doctor_debt" for a in alerts)
    assert services.ai_enabled(doc_p) is True


# 6 & 7
def test_manual_disable_and_reenable(doc_p, platform_admin, doctor):
    url = f"/api/v1/billing/admin/practitioners/{doc_p.pk}/ai-access"
    assert platform_admin.post(url, {"enabled": True}).data["ai_enabled"] is True
    r = platform_admin.post(url, {"enabled": False, "reason": "طلب الطبيب"})
    assert r.data["ai_enabled"] is False and services.ai_enabled(doc_p) is False
    assert platform_admin.post(url, {"enabled": True}).data["ai_enabled"] is True
    events = platform_admin.get(f"/api/v1/billing/admin/practitioners/{doc_p.pk}/ai-access-events").data
    assert [e["enabled"] for e in events] == [True, False, True]
    assert events[1]["reason"] == "طلب الطبيب" and events[1]["changed_by_name"]


# 8, 9, 10
def test_doctor_cannot_pay_reprice_toggle_or_read_others(doc_p, doctor, other_doctor):
    base = f"/api/v1/billing/admin/practitioners/{doc_p.pk}"
    assert doctor.post(f"{base}/payments", {"amount": "10", "method": "cash"}).status_code == 403
    assert doctor.post(f"{base}/price", {"price_per_minute": "0.01"}).status_code == 403
    assert doctor.post(f"{base}/ai-access", {"enabled": True}).status_code == 403
    other_p = other_doctor.user.practitioner
    assert doctor.get(f"/api/v1/billing/admin/practitioners/{other_p.pk}").status_code == 403
    # Own wallet: readable, without internal cost/margin.
    me = doctor.get("/api/v1/billing/me").data
    assert "provider_cost" not in me and "margin" not in me
    # Another doctor's receipts are not reachable through the self-service endpoint.
    _charge(other_p, 3)
    tx = LedgerTransaction.objects.filter(wallet__practitioner=other_p).first()
    assert doctor.get(f"/api/v1/billing/me/transactions/{tx.pk}/receipt").status_code == 404


# 11
def test_facility_admin_cannot_touch_wallets(make_actor, clinic, doc_p):
    manager = make_actor(clinic, [Role.ORG_ADMIN])
    base = f"/api/v1/billing/admin/practitioners/{doc_p.pk}"
    assert manager.post(f"{base}/payments", {"amount": "10", "method": "cash"}).status_code == 403
    assert manager.post(f"{base}/adjustments", {"kind": "credit_grant", "amount": "10",
                                                "reason": "x"}).status_code == 403
    assert manager.get("/api/v1/billing/admin/practitioners").status_code == 403


# 12
def test_repeated_charge_and_payment_requests_are_idempotent(doc_p, platform_admin):
    session = uuid.uuid4()
    first = _charge(doc_p, 7, session=session)
    again = _charge(doc_p, 7, session=session)
    assert first.created and not again.created
    assert AIUsageRecord.objects.filter(session_id=session).count() == 1
    assert _balance(doc_p) == D("-7.00")
    body = {"amount": "5", "currency": "USD", "method": "cash", "idempotency_key": "abc-1"}
    url = f"/api/v1/billing/admin/practitioners/{doc_p.pk}/payments"
    a = platform_admin.post(url, body).data
    b = platform_admin.post(url, body).data
    assert a["transaction"]["id"] == b["transaction"]["id"]
    assert _balance(doc_p) == D("-2.00")


# 13
def test_price_change_does_not_touch_past_charges(doc_p, platform_admin):
    services.set_custom_rate(doc_p, D("0.10"), actor=platform_admin.user)
    s1 = services.charge_ai_session(session_id=uuid.uuid4(), practitioner=doc_p,
                                    organization=None, audio_seconds=600)
    assert s1.usage.billed_amount == D("1.00") and s1.usage.price_per_minute == D("0.1000")
    platform_admin.post(f"/api/v1/billing/admin/practitioners/{doc_p.pk}/price",
                        {"price_per_minute": "0.50"})
    s1.usage.refresh_from_db()
    assert s1.usage.billed_amount == D("1.00")
    s2 = services.charge_ai_session(session_id=uuid.uuid4(), practitioner=doc_p,
                                    organization=None, audio_seconds=600)
    assert s2.usage.billed_amount == D("5.00")
    assert _balance(doc_p) == D("-6.00")


# 14
def test_failed_ai_is_not_charged_but_cost_is_recorded(doc_p):
    session = uuid.uuid4()
    services.record_failed_session(session_id=session, practitioner=doc_p, organization=None,
                                   provider_cost=D("0.03"))
    usage = AIUsageRecord.objects.get(session_id=session)
    assert usage.status == "not_billable" and usage.transaction is None
    assert usage.provider_cost == D("0.030000")
    assert _balance(doc_p) == D("0.00")
    # A later successful retry of the same session is charged once, costs accumulate.
    services.set_custom_rate(doc_p, D("0.10"), actor=None)
    services.charge_ai_session(session_id=session, practitioner=doc_p, organization=None,
                               audio_seconds=60, provider_cost=D("0.02"))
    usage.refresh_from_db()
    assert usage.status == "charged" and usage.provider_cost == D("0.050000")
    assert _balance(doc_p) == D("-0.10")


# 15 — real concurrency (separate DB connections)
@pytest.mark.django_db(transaction=True)
def test_concurrent_payments_and_charges_keep_ledger_consistent(make_actor, make_org):
    from apps.organizations.models import OrganizationKind

    actor = make_actor(make_org(kind=OrganizationKind.CLINIC), [Role.PHYSICIAN])
    practitioner = actor.user.practitioner
    wallet = services.practitioner_wallet(practitioner)
    services.set_custom_rate(practitioner, D("1.00"), actor=None)
    shared_session = uuid.uuid4()
    errors = []

    def pay():
        try:
            services.record_payment(wallet, amount=D("10"), currency="USD", paid_at=None,
                                    method="cash", actor=None)
        except Exception as e:
            errors.append(e)
        finally:
            connection.close()

    def charge(session):
        try:
            services.charge_ai_session(session_id=session, practitioner=practitioner,
                                       organization=None, audio_seconds=120)
        except Exception as e:
            errors.append(e)
        finally:
            connection.close()

    threads = [threading.Thread(target=pay) for _ in range(6)]
    threads += [threading.Thread(target=charge, args=(uuid.uuid4(),)) for _ in range(4)]
    threads += [threading.Thread(target=charge, args=(shared_session,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    wallet.refresh_from_db()
    # 6 payments of +10, 4 distinct sessions of -2, the shared session billed exactly once.
    assert wallet.balance == D("60") - D("8") - D("2")
    assert wallet.balance == services.recompute_balance(wallet)
    assert AIUsageRecord.objects.filter(session_id=shared_session).count() == 1


# 16
def test_reversal_creates_documented_entry(doc_p, platform_admin):
    _charge(doc_p, 200)
    pay = platform_admin.post(f"/api/v1/billing/admin/practitioners/{doc_p.pk}/payments",
                              {"amount": "150", "currency": "USD", "method": "cash"}).data
    tx_id = pay["transaction"]["id"]
    r = platform_admin.post(f"/api/v1/billing/admin/transactions/{tx_id}/reverse",
                            {"reason": "أُدخلت الدفعة لطبيب خطأ"})
    assert r.status_code == 201 and D(r.data["amount"]) == D("-150.00")
    assert r.data["reverses_id"] == tx_id
    assert _balance(doc_p) == D("-200.00")
    # The original is untouched and flagged reversed; it cannot be reversed twice.
    original = platform_admin.get(f"/api/v1/billing/admin/transactions/{tx_id}").data
    assert D(original["amount"]) == D("150.00") and original["is_reversed"] is True
    assert platform_admin.post(f"/api/v1/billing/admin/transactions/{tx_id}/reverse",
                               {"reason": "مرة ثانية"}).status_code == 409


# 17
def test_usage_linked_to_facility_billed_once_to_doctor(doc_p, clinic):
    result = _charge(doc_p, 4, organization=clinic)
    usage = result.usage
    assert usage.organization == clinic and usage.wallet.practitioner == doc_p
    assert LedgerTransaction.objects.filter(kind=TxKind.AI_USAGE).count() == 1
    assert not services.organization_wallet(clinic).transactions.exists()


def test_facility_payer_rule_bills_only_the_facility(doc_p, clinic):
    from apps.billing.models import OrganizationPayerRule

    OrganizationPayerRule.objects.create(organization=clinic, is_active=True)
    _charge(doc_p, 4, organization=clinic)
    assert services.organization_wallet(clinic).balance == D("-4.00")
    assert _balance(doc_p) == D("0.00")


def test_adjustments_signs_and_validation(doc_p, platform_admin):
    url = f"/api/v1/billing/admin/practitioners/{doc_p.pk}/adjustments"
    assert platform_admin.post(url, {"kind": "manual_debit", "amount": "20", "reason": "رسوم تدريب"}
                               ).status_code == 201
    assert platform_admin.post(url, {"kind": "credit_grant", "amount": "5", "reason": "هدية افتتاح"}
                               ).status_code == 201
    assert platform_admin.post(url, {"kind": "credit_grant", "amount": "-5", "reason": "x y z"}
                               ).status_code == 400
    assert platform_admin.post(url, {"kind": "settlement", "amount": "-1.5", "reason": "تسوية"}
                               ).status_code == 201
    assert _balance(doc_p) == D("-16.50")


def test_ledger_rows_cannot_be_updated_or_deleted(doc_p):
    _charge(doc_p, 1)
    tx = LedgerTransaction.objects.first()
    with pytest.raises(RuntimeError):
        tx.save()
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as c:
        c.execute("UPDATE billing_ledgertransaction SET amount = 999 WHERE id = %s", [tx.pk])
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as c:
        c.execute("DELETE FROM billing_ledgertransaction WHERE id = %s", [tx.pk])


def test_rounding_rules():
    plan = PricingPlan(price_per_minute=D("0.10"), rounding_mode="ceil_minute")
    assert services.price(61, plan) == (120, D("0.20"))
    assert services.price(600, plan) == (600, D("1.00"))
    assert services.price(0, plan) == (0, D("0.00"))
    plan.rounding_mode = "per_second"
    assert services.price(90, plan) == (90, D("0.15"))
    with pytest.raises(TypeError):
        services.money(0.1)


def test_admin_overview_list_and_csv(doc_p, platform_admin):
    _charge(doc_p, 30)
    platform_admin.post(f"/api/v1/billing/admin/practitioners/{doc_p.pk}/payments",
                        {"amount": "10", "currency": "USD", "method": "cash"})
    ov = platform_admin.get("/api/v1/billing/admin/overview").data
    assert D(ov["total_debt"]) == D("20.00") and ov["debtor_count"] == 1
    assert D(ov["total_collected"]) == D("10.00") and D(ov["ai_revenue"]) == D("30.00")
    rows = platform_admin.get("/api/v1/billing/admin/practitioners", data={"status": "debtor"}).data
    assert rows[0]["name"] == doc_p.display_name and D(rows[0]["debt"]) == D("20.00")
    csv_body = platform_admin.get("/api/v1/billing/admin/export.csv").content.decode("utf-8-sig")
    assert doc_p.display_name in csv_body and "20.00" in csv_body


def test_statement_has_no_patient_data(doc_p, doctor):
    _charge(doc_p, 2)
    lines = doctor.get("/api/v1/billing/me/transactions").data["results"]
    assert set(lines[0]) == {"id", "kind", "amount", "currency", "balance_after", "occurred_at",
                             "created_at", "created_by_name", "organization_name", "description",
                             "payment_method", "reference", "receipt_number", "reverses_id",
                             "is_reversed"}


_ = Actor
