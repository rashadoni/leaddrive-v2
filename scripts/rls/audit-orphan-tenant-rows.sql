-- Do the 83 tables already hold rows belonging to deleted tenants?
--
-- This decides what the fix for F-24 actually is. A cascading foreign key can
-- only be added to a table whose existing rows already satisfy it, so if any of
-- these still point at an organisation that no longer exists, the migration
-- fails outright — and the real first task is deciding what to do with data
-- whose owner is already gone, which is a retention question, not a schema one.
--
-- Read-only: counts rows, changes nothing.
--
--   cd /opt/leaddrive-v2/.next/standalone   # the copy this release shipped; /opt/leaddrive-v2
--                                          # itself is a stale git checkout, not the release
--   psql "$DATABASE_URL" -f scripts/rls/audit-orphan-tenant-rows.sql
--
-- This script refuses to run through an RLS-filtered role: an empty result from
-- a role that cannot see every tenant is not evidence. Empty output from the
-- required privileged role = no detected orphans among missing or NOT VALID
-- organization keys.
-- Any row = that table holds data for tenants that were deleted, with the count.
-- Record the result in docs/isms/ISMS-12-retention.md section 4.

DO $$
DECLARE
  r record;
  n bigint;
  found boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = current_user
       AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'orphan audit requires a superuser or BYPASSRLS role';
  END IF;

  -- NOT "ON COMMIT DROP": a DO block runs in its own transaction, so the table
  -- would be dropped the moment the block ends and the SELECT below would fail
  -- with "relation orphan_report does not exist" — which is exactly what the
  -- first production run did, after the NOTICE had already given the answer.
  -- TRUNCATE instead, so re-running in one psql session starts clean.
  CREATE TEMP TABLE IF NOT EXISTS orphan_report(tbl text, orphan_rows bigint);
  TRUNCATE orphan_report;

  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organizationId'
                       AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_constraint fk
      ON fk.conrelid = c.oid AND fk.contype = 'f'
     AND fk.confrelid = 'public.organizations'::regclass
     AND a.attnum = ANY (fk.conkey)
    WHERE c.relkind = 'r'
      AND c.relname <> 'organizations'
      AND (
        fk.conname IS NULL
        OR fk.confdeltype <> 'c'
        OR NOT fk.convalidated
      )
    ORDER BY 1
  LOOP
    -- Counting only rows whose owner is gone; a NULL organizationId is a
    -- different problem and not this one.
    EXECUTE format(
      'SELECT count(*) FROM public.%I t WHERE t."organizationId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = t."organizationId")',
      r.tbl
    ) INTO n;
    IF n > 0 THEN
      INSERT INTO orphan_report VALUES (r.tbl, n);
      found := true;
    END IF;
  END LOOP;

  IF NOT found THEN
    RAISE NOTICE 'No orphaned rows detected by the privileged aggregate scan.';
  END IF;
END $$;

SELECT tbl AS table_with_orphans, orphan_rows
FROM orphan_report
ORDER BY orphan_rows DESC, tbl;
