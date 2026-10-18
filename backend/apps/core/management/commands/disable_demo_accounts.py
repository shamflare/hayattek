"""Pre-launch hardening: lock every synthetic demo account (and their sessions/tokens).

Demo users are identified by the reserved domain `@hayattek.test` (seed_demo). Accounts are
deactivated and their passwords made unusable — not deleted — so audit history stays intact.
Run with --dry-run first. See docs/PRODUCTION_READINESS.md §accounts.
"""

from django.contrib.sessions.models import Session
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

DEMO_DOMAIN = "@hayattek.test"


class Command(BaseCommand):
    help = "Deactivate synthetic demo accounts and revoke their sessions and device tokens."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, dry_run=False, **options):
        from apps.accounts.models import DeviceToken, User

        users = list(User.objects.filter(email__iendswith=DEMO_DOMAIN))
        self.stdout.write(f"demo accounts found: {len(users)}")
        for user in users:
            self.stdout.write(f"  {user.email}")
        if dry_run or not users:
            return
        ids = {str(u.pk) for u in users}
        with transaction.atomic():
            for user in users:
                user.is_active = False
                user.set_unusable_password()
                user.mfa_secret = ""
                user.save()
            DeviceToken.objects.filter(user__in=users, revoked_at__isnull=True).update(
                revoked_at=timezone.now())
            for session in Session.objects.filter(expire_date__gt=timezone.now()):
                if session.get_decoded().get("_auth_user_id") in ids:
                    session.delete()
        self.stdout.write(self.style.SUCCESS(f"disabled {len(users)} demo accounts"))
