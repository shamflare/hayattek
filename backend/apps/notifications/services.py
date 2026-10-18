from collections.abc import Iterable

from .models import Notification


def notify(users: Iterable, *, kind: str, title: str, body: str = "", link: str = "",
           data: dict | None = None) -> None:
    """Create in-app notifications. Keep text generic: no diagnoses, results or drug names."""
    seen = set()
    rows = []
    for user in users:
        if user is None or user.pk in seen:
            continue
        seen.add(user.pk)
        rows.append(Notification(user=user, kind=kind, title=title, body=body, link=link,
                                 data=data or {}))
    Notification.objects.bulk_create(rows)


def patient_recipients(patient) -> list:
    """The patient's own account plus guardians allowed to view records."""
    from django.db.models import Q
    from django.utils import timezone

    users = [patient.user] if patient.user_id else []
    guardians = patient.guardians.filter(revoked_at__isnull=True, can_view_records=True).filter(
        Q(valid_until__isnull=True) | Q(valid_until__gte=timezone.localdate())
    ).select_related("guardian")
    users.extend(g.guardian for g in guardians)
    return users
