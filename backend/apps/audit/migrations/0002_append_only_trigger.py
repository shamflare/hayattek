"""ADR-008: block UPDATE/DELETE on the audit table at the database level."""

from django.db import migrations

SQL = """
CREATE OR REPLACE FUNCTION hayat_audit_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_auditevent is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_auditevent_no_update
    BEFORE UPDATE OR DELETE ON audit_auditevent
    FOR EACH ROW EXECUTE FUNCTION hayat_audit_block_mutation();

CREATE TRIGGER audit_auditevent_no_truncate
    BEFORE TRUNCATE ON audit_auditevent
    FOR EACH STATEMENT EXECUTE FUNCTION hayat_audit_block_mutation();
"""

REVERSE = """
DROP TRIGGER IF EXISTS audit_auditevent_no_update ON audit_auditevent;
DROP TRIGGER IF EXISTS audit_auditevent_no_truncate ON audit_auditevent;
DROP FUNCTION IF EXISTS hayat_audit_block_mutation();
"""


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
