"""Outbound messaging service (PHASE2 §5): outbox + Celery dispatch, safe retries with
exponential backoff, idempotency, per-recipient rate limiting and honest delivery status.

Callers use :func:`send_message` and read ``message.status`` / :func:`delivery_state` to tell
the user what really happened. Nothing here ever bypasses a security check: when SMS is not
configured the OTP is simply not delivered (the UI says so and offers in-person checks).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.core.ids import uuid7

from .models import MessageChannel, MessagePurpose, MessageStatus, OutboundMessage
from .providers import SendResult, get_email_provider
from .sms import get_sms_provider

logger = logging.getLogger("hayat.messaging")

BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX_SECONDS = 3600


def get_provider(channel: str):
    return get_sms_provider() if channel == MessageChannel.SMS else get_email_provider()


def _normalize(channel: str, to: str) -> str:
    to = (to or "").strip()
    return to.lower() if channel == MessageChannel.EMAIL else to.replace(" ", "")


def recipient_hash(channel: str, to: str) -> str:
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, f"{channel}:{_normalize(channel, to)}".encode(),
                    hashlib.sha256).hexdigest()


def mask_recipient(channel: str, to: str) -> str:
    to = _normalize(channel, to)
    if channel == MessageChannel.EMAIL:
        local, _, domain = to.partition("@")
        return f"{local[:1]}***@{domain}" if domain else "***"
    return f"{to[:4]}***{to[-3:]}" if len(to) > 7 else "***"


def backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_BASE_SECONDS * 2 ** max(attempts - 1, 0), BACKOFF_MAX_SECONDS)


def delivery_state(message: OutboundMessage | None) -> str:
    """API-facing delivery state: queued | sent | not_configured | failed | suppressed."""
    if message is None:
        return MessageStatus.NOT_CONFIGURED
    if message.status == MessageStatus.SENDING:
        return MessageStatus.QUEUED
    return message.status


def _rate_limited(rhash: str, purpose: str) -> bool:
    cfg = settings.HAYAT
    since = timezone.now() - timedelta(minutes=cfg["MESSAGE_RATE_WINDOW_MINUTES"])
    recent = OutboundMessage.objects.filter(recipient_hash=rhash, created_at__gte=since).exclude(
        status__in=[MessageStatus.SUPPRESSED, MessageStatus.NOT_CONFIGURED])
    if recent.count() >= cfg["MESSAGE_RATE_LIMIT"]:
        return True
    return purpose == MessagePurpose.OTP and recent.filter(
        purpose=MessagePurpose.OTP).count() >= cfg["OTP_RATE_LIMIT"]


def send_message(*, channel: str, to: str, purpose: str, body: str, subject: str = "",
                 idempotency_key: str = "") -> OutboundMessage:
    """Queue one message and dispatch it. Same ``idempotency_key`` -> same row, no resend."""
    key = idempotency_key or f"{purpose}:{uuid7().hex}"
    existing = OutboundMessage.objects.filter(idempotency_key=key).first()
    if existing is not None:
        return existing

    provider = get_provider(channel)
    rhash = recipient_hash(channel, to)
    if not to:
        status, error = MessageStatus.FAILED, "no_recipient"
    elif _rate_limited(rhash, purpose):
        status, error = MessageStatus.SUPPRESSED, "rate_limited"
    elif not getattr(provider, "configured", True):
        status, error = MessageStatus.NOT_CONFIGURED, ""
    else:
        status, error = MessageStatus.QUEUED, ""
    pending = status == MessageStatus.QUEUED
    try:
        with transaction.atomic():
            message = OutboundMessage.objects.create(
                channel=channel, purpose=purpose, to=to if pending else "",
                recipient_hash=rhash, recipient_masked=mask_recipient(channel, to),
                subject=subject[:200] if pending else "", body=body if pending else "",
                status=status, last_error=error, provider=provider.name,
                max_attempts=settings.HAYAT["MESSAGE_MAX_ATTEMPTS"], idempotency_key=key)
    except IntegrityError:  # concurrent duplicate with the same key
        return OutboundMessage.objects.get(idempotency_key=key)
    logger.info("outbound message %s channel=%s purpose=%s to=%s status=%s", message.pk,
                channel, purpose, message.recipient_masked, status)
    if pending:
        _dispatch(message)
        message.refresh_from_db()
    return message


def _dispatch(message: OutboundMessage) -> None:
    from .tasks import deliver_message

    message_id = str(message.pk)
    if (settings.HAYAT.get("MESSAGE_DISPATCH") == "celery"
            and not getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False)):
        def enqueue():
            try:
                deliver_message.delay(message_id)
            except Exception:  # broker down: dispatch_due_messages picks it up later
                logger.exception("could not enqueue message %s", message_id)
        transaction.on_commit(enqueue)
    else:  # dev / tests: deliver inline (retries run through the same task)
        deliver_message.apply(args=(message_id,))


def deliver(message_id: str) -> str:
    """One delivery attempt. Returns the new status (``queued`` means: retry scheduled)."""
    now = timezone.now()
    claimed = OutboundMessage.objects.filter(pk=message_id, status=MessageStatus.QUEUED).update(
        status=MessageStatus.SENDING, attempts=F("attempts") + 1, updated_at=now)
    message = OutboundMessage.objects.filter(pk=message_id).first()
    if message is None or not claimed:
        return message.status if message else MessageStatus.FAILED

    provider = get_provider(message.channel)
    try:
        if not getattr(provider, "configured", True):
            result = SendResult.not_configured(provider.name)
        elif message.channel == MessageChannel.SMS:
            result = provider.send(message.to, message.body)
        else:
            result = provider.send(message.to, message.subject, message.body)
    except Exception as exc:  # provider bug/outage: never log the message or recipient
        result = SendResult.failed(provider.name, f"exception:{type(exc).__name__}")
    result = result or SendResult.failed(provider.name, "no_result")

    message.provider = result.provider or provider.name
    message.next_attempt_at = None
    if result.status == "sent":
        message.status = MessageStatus.SENT
        message.sent_at = timezone.now()
        message.provider_message_id = result.provider_message_id[:120]
        message.last_error = ""
    elif result.status == "not_configured":
        message.status = MessageStatus.NOT_CONFIGURED
        message.last_error = ""
    elif result.retryable and message.attempts < message.max_attempts:
        message.status = MessageStatus.QUEUED
        message.last_error = result.error[:200]
        message.next_attempt_at = timezone.now() + timedelta(
            seconds=backoff_seconds(message.attempts))
    else:
        message.status = MessageStatus.FAILED
        message.last_error = result.error[:200]
    if message.status != MessageStatus.QUEUED:
        message.to = ""  # data minimisation: nothing left to deliver
        message.body = ""
        message.subject = ""
    message.save()
    logger.info("outbound message %s attempt=%s status=%s error=%s", message.pk,
                message.attempts, message.status, message.last_error)
    return message.status


def due_message_ids(limit: int = 100) -> list[str]:
    """Queued messages whose retry time has come (or that lost their task), plus rows stuck
    in ``sending`` after a worker crash (requeued: at-least-once delivery)."""
    now = timezone.now()
    OutboundMessage.objects.filter(status=MessageStatus.SENDING,
                                   updated_at__lt=now - timedelta(minutes=10)).update(
        status=MessageStatus.QUEUED, next_attempt_at=now)
    ids = OutboundMessage.objects.filter(status=MessageStatus.QUEUED).filter(
        Q(next_attempt_at__lte=now)
        | Q(next_attempt_at__isnull=True, created_at__lt=now - timedelta(minutes=2))
    ).order_by("created_at").values_list("pk", flat=True)[:limit]
    return [str(pk) for pk in ids]
