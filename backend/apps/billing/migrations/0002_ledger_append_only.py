"""The ledger is append-only at the database level (same guard as the audit log)."""

from django.db import migrations

SQL = """
CREATE TRIGGER billing_ledger_no_update
    BEFORE UPDATE OR DELETE ON billing_ledgertransaction
    FOR EACH ROW EXECUTE FUNCTION hayat_audit_block_mutation();
CREATE TRIGGER billing_ledger_no_truncate
    BEFORE TRUNCATE ON billing_ledgertransaction
    FOR EACH STATEMENT EXECUTE FUNCTION hayat_audit_block_mutation();
"""

REVERSE = """
DROP TRIGGER IF EXISTS billing_ledger_no_update ON billing_ledgertransaction;
DROP TRIGGER IF EXISTS billing_ledger_no_truncate ON billing_ledgertransaction;
"""


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial"), ("audit", "0003_truncate_only_in_tests")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
