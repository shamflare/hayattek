from celery import shared_task

from .services import push_study_now


@shared_task(ignore_result=True, acks_late=True)
def push_study(study_id: str) -> None:
    push_study_now(study_id)
