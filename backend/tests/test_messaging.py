"""Outbound messaging (PHASE2 §5): outbox, idempotency, rate limits, retries, honesty."""

import pytest
from django.core import mail

from apps.notifications.messaging import send_message
from apps.notifications.models import OutboundMessage
from apps.notifications.providers import SendResult
from apps.notifications.sms import ConsoleSmsProvider, SmsProvider
from apps.notifications.tasks import dispatch_due_messages
from apps.patients.models import Patient

PHONE = "+963933000222"


class FlakySmsProvider(SmsProvider):
    """Fails ``fail_times`` times, then delivers."""

    name = "flaky"
    fail_times = 1
    calls = 0

    def send(self, phone, message):
        FlakySmsProvider.calls += 1
        if FlakySmsProvider.calls <= FlakySmsProvider.fail_times:
            return SendResult.failed(self.name, "http_503")
        return SendResult.sent(self.name, f"vendor-{FlakySmsProvider.calls}")


class CrashingSmsProvider(SmsProvider):
    name = "crashing"

    def send(self, phone, message):
        raise TimeoutError(f"timeout talking about {phone}")  # must never be stored


@pytest.fixture
def hayat(settings):
    def _set(**values):
        settings.HAYAT = {**settings.HAYAT, **values}
    return _set


@pytest.fixture(autouse=True)
def _clean_console():
    ConsoleSmsProvider.sent.clear()
    FlakySmsProvider.calls = 0
    yield


def _sms(key="", purpose="notification", to=PHONE, body="رسالة تجريبية"):
    return send_message(channel="sms", to=to, purpose=purpose, body=body, idempotency_key=key)


def test_idempotency_same_key_sends_once(db):
    first = _sms("k-1")
    second = _sms("k-1")
    assert first.pk == second.pk and first.status == "sent"
    assert len(ConsoleSmsProvider.sent) == 1
    assert OutboundMessage.objects.filter(idempotency_key="k-1").count() == 1


def test_sent_message_keeps_no_body_or_destination(db):
    message = _sms("k-min", purpose="otp", body="رمزك 123456")
    assert message.status == "sent" and message.sent_at is not None
    assert message.body == "" and message.to == ""
    assert message.recipient_masked == "+963***222"
    assert "123456" not in str(OutboundMessage.objects.filter(pk=message.pk).values().first())


def test_rate_limit_per_recipient_and_otp(db, hayat):
    hayat(MESSAGE_RATE_LIMIT=3, OTP_RATE_LIMIT=2)
    assert [_sms(f"n{i}").status for i in range(3)] == ["sent"] * 3
    assert _sms("n4").status == "suppressed"
    assert len(ConsoleSmsProvider.sent) == 3
    # Another recipient is unaffected; OTPs have their own, stricter limit.
    other = "+963944000333"
    assert [_sms(f"o{i}", purpose="otp", to=other).status for i in range(3)] == [
        "sent", "sent", "suppressed"]


def test_retry_with_backoff_then_success(db, hayat):
    hayat(SMS_PROVIDER="tests.test_messaging.FlakySmsProvider")
    FlakySmsProvider.fail_times = 2
    message = _sms("retry-1")
    message.refresh_from_db()
    assert message.status == "sent" and message.attempts == 3
    assert message.provider_message_id == "vendor-3" and message.last_error == ""


def test_gives_up_after_max_attempts_without_leaking(db, hayat):
    hayat(SMS_PROVIDER="tests.test_messaging.CrashingSmsProvider", MESSAGE_MAX_ATTEMPTS=3)
    message = _sms("crash-1", body="سري 987654")
    message.refresh_from_db()
    assert message.status == "failed" and message.attempts == 3
    assert message.last_error == "exception:TimeoutError"
    assert message.body == "" and message.to == "" and PHONE not in message.last_error


def test_dispatch_due_messages_retries_queued(db):
    message = OutboundMessage.objects.create(
        channel="sms", purpose="notification", to=PHONE, recipient_hash="h", body="x",
        recipient_masked="***", status="queued", idempotency_key="due-1", provider="console")
    OutboundMessage.objects.filter(pk=message.pk).update(next_attempt_at="2000-01-01T00:00Z")
    assert dispatch_due_messages() == 1
    message.refresh_from_db()
    assert message.status == "sent"


def test_otp_not_configured_is_reported_honestly(reception, other_doctor, make_patient,
                                                 hayat):
    hayat(SMS_PROVIDER="apps.notifications.sms.NotConfiguredSmsProvider")
    patient = make_patient(reception)
    p = Patient.objects.get(pk=patient["id"])
    r = other_doctor.post("/api/v1/access/requests", {
        "health_number": p.health_number, "scopes": ["summary"], "hours": 4, "channel": "otp"})
    assert r.status_code == 201
    assert r.data["delivery"] == "not_configured"
    assert ConsoleSmsProvider.sent == []
    message = OutboundMessage.objects.get(idempotency_key=f"otp:{r.data['id']}")
    assert message.status == "not_configured" and message.body == "" and message.to == ""
    # The code is never exposed to staff, and the list endpoint reports the same state.
    assert not any(len(str(v)) == 6 and str(v).isdigit() for v in r.data.values())
    from apps.access.models import AccessRequest
    from apps.access.serializers import AccessRequestSerializer

    stored = AccessRequest.objects.get(pk=r.data["id"])  # fresh object: read from the outbox
    assert AccessRequestSerializer(stored).data["delivery"] == "not_configured"
    # Security is not bypassed: guessing still fails.
    bad = other_doctor.post(f"/api/v1/access/requests/{r.data['id']}/verify-otp",
                            {"otp": "000000"})
    assert bad.status_code == 400


def test_otp_sent_reports_delivery_and_resend_is_limited(reception, other_doctor,
                                                         make_patient, hayat):
    hayat(OTP_RATE_LIMIT=2)
    patient = make_patient(reception)
    p = Patient.objects.get(pk=patient["id"])
    payload = {"health_number": p.health_number, "scopes": ["summary"], "hours": 4,
               "channel": "otp"}
    first = other_doctor.post("/api/v1/access/requests", payload)
    assert first.status_code == 201 and first.data["delivery"] == "sent"
    assert other_doctor.post("/api/v1/access/requests", payload).status_code == 201
    third = other_doctor.post("/api/v1/access/requests", payload)
    assert third.status_code == 429 and third.data["code"] == "sms_rate_limited"
    assert len(ConsoleSmsProvider.sent) == 2


def test_activation_reports_delivery(reception, make_patient, hayat):
    hayat(SMS_PROVIDER="apps.notifications.sms.NotConfiguredSmsProvider")
    patient = make_patient(reception, phone="0933444555")
    r = reception.post(f"/api/v1/patients/{patient['id']}/account", {})
    assert r.status_code == 201 and r.data["delivery"] == "not_configured"


def test_password_reset_goes_through_outbox(client, make_user):
    user = make_user(email="reset@test.hayat")
    mail.outbox.clear()
    r = client.post("/api/v1/auth/password/reset", {"identifier": user.email},
                    content_type="application/json")
    assert r.status_code == 200 and r.json() == {"ok": True}
    message = OutboundMessage.objects.get(purpose="password_reset")
    assert message.channel == "email" and message.status == "sent"
    assert len(mail.outbox) == 1 and "/reset-password?" in mail.outbox[0].body
    # Unknown accounts: same answer, nothing queued.
    r = client.post("/api/v1/auth/password/reset", {"identifier": "nobody@test.hayat"},
                    content_type="application/json")
    assert r.json() == {"ok": True} and OutboundMessage.objects.count() == 1


def test_email_not_configured(db, hayat):
    hayat(EMAIL_PROVIDER="apps.notifications.providers.NotConfiguredEmailProvider")
    message = send_message(channel="email", to="a@test.hayat", purpose="notification",
                           subject="s", body="b", idempotency_key="e-1")
    assert message.status == "not_configured" and len(mail.outbox) == 0


def test_admin_message_log_is_masked_and_admin_only(platform_admin, doctor, db):
    _sms("adm-1", purpose="otp", body="رمزك 555111")
    r = platform_admin.get("/api/v1/admin/messages")
    assert r.status_code == 200
    row = r.data["results"][0]
    assert row["recipient_masked"] == "+963***222" and row["purpose"] == "otp"
    assert "body" not in row and "to" not in row and "555111" not in str(r.data)
    assert platform_admin.get("/api/v1/admin/messages", data={"status": "failed"}
                              ).data["count"] == 0
    stats = platform_admin.get("/api/v1/admin/messages/stats").data
    assert stats["by_status"]["sent"] == 1 and stats["sms_provider"] == "console"
    assert doctor.get("/api/v1/admin/messages").status_code == 403
