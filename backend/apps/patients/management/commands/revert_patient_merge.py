"""Platform-support path to undo a patient merge after the facility undo window (ADR-027).

    manage.py revert_patient_merge <case_id> --by admin@example.org --reason "..."

Requires a platform administrator account as the acting user; the undo is audited.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.core.exceptions import DomainError
from apps.patients.merge import revert_merge
from apps.patients.models import PatientMergeCase


class Command(BaseCommand):
    help = "Undo a patient merge (platform support, audited)."

    def add_arguments(self, parser):
        parser.add_argument("case_id")
        parser.add_argument("--by", required=True, help="Email of the platform administrator.")
        parser.add_argument("--reason", required=True)

    def handle(self, *args, case_id, by, reason, **options):
        actor = User.objects.filter(email__iexact=by, is_platform_admin=True).first()
        if actor is None:
            raise CommandError("--by must be a platform administrator account.")
        case = PatientMergeCase.objects.filter(pk=case_id).first()
        if case is None:
            raise CommandError("Merge case not found.")
        try:
            case = revert_merge(case=case, reason=reason, actor=actor, enforce_window=False)
        except DomainError as exc:
            raise CommandError(str(exc.detail)) from exc
        report = case.revert_report
        self.stdout.write(self.style.SUCCESS(f"Reverted. Restored: {report.get('restored')}"))
        if report.get("created_after_merge"):
            self.stdout.write(self.style.WARNING(
                "Rows created on the surviving file after the merge need manual review: "
                f"{report['created_after_merge']}"))
