"""Post-restore (and periodic) integrity check. Exit code 1 on any problem.

Checks: migrations applied, append-only triggers present, every wallet's cached balance equals
the sum of its ledger, ledger chains consistent, and basic row counts.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

REQUIRED_TRIGGERS = {
    ("audit_auditevent", "audit_auditevent_no_update"),
    ("audit_auditevent", "audit_auditevent_no_truncate"),
    ("billing_ledgertransaction", "billing_ledger_no_update"),
    ("billing_ledgertransaction", "billing_ledger_no_truncate"),
}


class Command(BaseCommand):
    help = "Verify database integrity after a restore."

    def handle(self, *args, **options):
        from apps.billing.models import LedgerTransaction, WalletAccount
        from apps.billing.services import recompute_balance

        problems: list[str] = []
        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        if pending:
            problems.append(f"{len(pending)} migrations not applied")

        with connection.cursor() as cursor:
            # pg_trigger (not information_schema) also lists TRUNCATE triggers.
            cursor.execute("SELECT c.relname, t.tgname FROM pg_trigger t "
                           "JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal")
            present = {(t, n) for t, n in cursor.fetchall()}
        missing = REQUIRED_TRIGGERS - present
        if missing:
            problems.append(f"append-only triggers missing: {sorted(missing)}")

        wallets = 0
        for wallet in WalletAccount.objects.all():
            wallets += 1
            if wallet.balance != recompute_balance(wallet):
                problems.append(f"wallet {wallet.pk}: cached {wallet.balance} != ledger "
                                f"{recompute_balance(wallet)}")
            last = wallet.transactions.order_by("-created_at").first()
            if last and last.balance_after != wallet.balance:
                problems.append(f"wallet {wallet.pk}: last balance_after != balance")

        counts = {}
        with connection.cursor() as cursor:
            for table in ("patients_patient", "clinical_encounter", "medications_prescription",
                          "documents_clinicaldocument", "audit_auditevent",
                          "billing_ledgertransaction"):
                cursor.execute(f"SELECT COUNT(*) FROM {table}")  # noqa: S608 - fixed names
                counts[table] = cursor.fetchone()[0]
        self.stdout.write(f"wallets checked: {wallets}; ledger lines: "
                          f"{LedgerTransaction.objects.count()}")
        for table, n in counts.items():
            self.stdout.write(f"  {table}: {n}")
        if problems:
            for p in problems:
                self.stderr.write(f"PROBLEM: {p}")
            raise CommandError("integrity check failed")
        self.stdout.write(self.style.SUCCESS("integrity OK"))
