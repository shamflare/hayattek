"""Allow TRUNCATE of append-only tables only when the session explicitly opts in.

The test settings set `hayat.allow_truncate=on` on their connections so transactional
tests (real concurrency tests) can be flushed. Production never sets it, so UPDATE,
DELETE and TRUNCATE stay blocked there.
"""

from django.db import migrations

SQL = """
CREATE OR REPLACE FUNCTION hayat_audit_block_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'TRUNCATE' AND current_setting('hayat.allow_truncate', true) = 'on' THEN
        RETURN NULL;
    END IF;
    RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
"""

REVERSE = """
CREATE OR REPLACE FUNCTION hayat_audit_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_auditevent is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
"""


class Migration(migrations.Migration):
    dependencies = [("audit", "0002_append_only_trigger")]
    operations = [migrations.RunSQL(SQL, REVERSE)]
