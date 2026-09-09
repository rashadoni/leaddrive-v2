-- F-25 (docs/isms/ISMS-02-gap-analysis.md): move tenant isolation out of
-- hand-run SQL and into a migration.
--
-- Measured on production 2026-08-25: 479 tenant tables, but only ~150 received
-- RLS from a migration. The rest were switched on by someone running SQL on the
-- box. A database rebuilt from migrations — which is exactly what a rebuild
-- after losing the server produces — therefore came up with those tables wide
-- open, and nothing failed: RLS absent means the query simply returns every
-- tenant's rows.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--
-- 58 tenant tables carry policies under their OWN names rather than
-- `tenant_isolation`, and several are split by command:
-- `mtm_pharmacy_ledger_tenant_select` / `_tenant_insert` / `_bypass_delete`
-- and siblings. Those splits are the point — the table is append-only, and
-- DELETE is permitted only under bypass.
--
-- PostgreSQL combines permissive policies with OR. Adding a broad
-- `tenant_isolation` to such a table would re-open DELETE to any ordinary
-- tenant session and quietly undo the append-only guarantee. So the loop skips
-- every table that already carries a policy under a different name, and only
-- ever writes the canonical policy where there is none or where the canonical
-- one already exists (in which case it is a no-op).
--
-- Idempotent by construction: safe on production, where most of this is already
-- true, and correct on a fresh database, where none of it is.

DO $$
DECLARE
  t record;
  n_enabled int := 0;
  n_skipped int := 0;
BEGIN
  FOR t IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND ns.nspname = 'public'
      -- a tenant table is one carrying the tenant key
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'organizationId'
      )
      -- only tables this role may alter; membership in the owning role counts
      AND pg_has_role(current_user, c.relowner, 'USAGE')
    ORDER BY c.relname
  LOOP
    -- Skip anything already governed by a purpose-built policy set.
    IF EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = t.oid AND p.polname <> 'tenant_isolation'
    ) THEN
      n_skipped := n_skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    -- FORCE matters because the application role owns most of these tables, and
    -- an owner bypasses RLS without it. Without FORCE the policy is decoration.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.relname);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = t.oid AND p.polname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        'USING ("organizationId" = current_setting(''app.org_id'', true) '
        '       OR current_setting(''app.rls_bypass'', true) = ''on'') '
        'WITH CHECK ("organizationId" = current_setting(''app.org_id'', true) '
        '       OR current_setting(''app.rls_bypass'', true) = ''on'')',
        t.relname
      );
    END IF;

    n_enabled := n_enabled + 1;
  END LOOP;

  RAISE NOTICE 'tenant isolation: % tables enforced, % left to their own policies', n_enabled, n_skipped;
END $$;
