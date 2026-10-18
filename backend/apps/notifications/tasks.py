import logging

from celery import shared_task
from django.utils import timezone

from .models import MessageStatus, OutboundMessage

logger = logging.getLogger("hayat.messaging")


@shared_task(ignore_result=True)
def deliver_message(message_id: str) -> None:
    """Deliver one outbox row; on a retryable failure re-schedule itself with backoff."""
    from .messaging import deliver

    if deliver(message_id) != MessageStatus.QUEUED:
        return
    message = OutboundMessage.objects.filter(pk=message_id).only("next_attempt_at").first()
    if message is None or message.next_attempt_at is None:
        return
    countdown = max(int((message.next_attempt_at - timezone.now()).total_seconds()), 0)
    try:
        deliver_message.apply_async((message_id,), countdown=countdown)
    except Exception:  # broker down: dispatch_due_messages (beat) retries it
        logger.exception("could not schedule retry for message %s", message_id)


@shared_task(ignore_result=True)
def dispatch_due_messages() -> int:
    """Celery beat sweeper: retries due messages that have no pending task."""
    from .messaging import due_message_ids

    ids = due_message_ids()
    for message_id in ids:
        deliver_message.delay(message_id)
    return len(ids)
