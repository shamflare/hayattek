from celery import shared_task
from django.utils import timezone

from .providers import ProviderError


@shared_task(bind=True, ignore_result=True, max_retries=2, default_retry_delay=20)
def process_session_task(self, session_id: str) -> None:
    from . import services

    try:
        services.process_session(session_id)
    except ProviderError:
        # Session is marked failed (not billed). The doctor can retry from the UI; automatic
        # retries are left to the explicit retry action to keep billing semantics simple.
        return


@shared_task(ignore_result=True)
def purge_expired_audio() -> int:
    """Retention policy: delete recordings past `retention_until` (run daily via beat)."""
    from . import services
    from .models import ScribeSession

    count = 0
    for session in ScribeSession.objects.filter(retention_until__lt=timezone.now(),
                                                audio_deleted_at__isnull=True).exclude(audio_file=""):
        services.delete_audio(session, reason="retention")
        count += 1
    return count
