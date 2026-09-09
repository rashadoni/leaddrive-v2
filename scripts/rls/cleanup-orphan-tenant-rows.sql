-- Remove rows whose owning tenant no longer exists — after copying them aside.
--
-- These are the leftovers from tenant deletions performed BEFORE the cascade
-- migrations of 2026-08-27. Back then `hardDeleteTenant` deleted the
-- organizations row and trusted a cascade that 83 tables did not have, so the
-- delete "succeeded" and the data stayed. The cascades exist now, but they were
-- added `NOT VALID`: new deletions cascade correctly, while the rows orphaned
-- earlier are still sitting there. This clears those.
--
--   cd /opt/leaddrive-v2/.next/standalone   # the copy this release shipped; /opt/leaddrive-v2
--                                          # itself is a stale git checkout, not the release
--   set -a; . /etc/leaddrive/migration.env; set +a
--   psql "$MIGRATION_DATABASE_URL" -f scripts/rls/cleanup-orphan-tenant-rows.sql
--
-- MIGRATION_DATABASE_URL, not DATABASE_URL: the app role is subject to FORCE
-- RLS, which fails CLOSED. Running this as the app role would find no rows,
-- delete nothing, and print a clean report — a false all-clear is worse than an
-- error, so the block refuses to start without BYPASSRLS.
--
-- Everything runs in ONE transaction. If any part fails, nothing is deleted.
--
-- Rows are copied into schema `orphan_quarantine` before deletion, one table
-- per source table. That is the undo: the data is still in the database, out of
-- the way of every application query. Drop the schema once the result has been
-- reviewed and a backup cycle has passed.

DO $$
DECLARE
  r record;
  n bigint;
  q text;
  pass int := 0;
  progress boolean := true;
  moved bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'orphan cleanup needs a superuser or BYPASSRLS role; use MIGRATION_DATABASE_URL';
  END IF;

  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '15min';

  CREATE SCHEMA IF NOT EXISTS orphan_quarantine;

  CREATE TEMP TABLE IF NOT EXISTS cleanup_report(
    tbl text PRIMARY KEY, orphan_rows bigint, status text
  );
  TRUNCATE cleanup_report;

  -- Every table carrying organizationId is scanned, whatever its foreign key
  -- looks like. Filtering by FK shape is what made the first orphan audit skip
  -- the 73 tables it was written to inspect: once the migration added keys, the
  -- filter excluded exactly the tables the question was about. A validated
  -- cascading key simply yields zero here, which costs a count and removes a
  -- whole class of mistake.
  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organizationId'
                         AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relkind = 'r' AND c.relname <> 'organizations'
     ORDER BY 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I t WHERE t."organizationId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = t."organizationId")',
      r.tbl
    ) INTO n;

    CONTINUE WHEN n = 0;

    -- Retention-bound tables are reported, never deleted. ISMS-12 §1 keeps
    -- audit and compliance records for a fixed period regardless of whether the
    -- tenant still exists — that is the point of an audit record. Deciding to
    -- shorten that is a retention change, not a cleanup, and it does not get
    -- made silently inside a maintenance script.
    IF r.tbl ~ 'audit|compliance|_log$|_logs$|history|evidence' THEN
      INSERT INTO cleanup_report VALUES (r.tbl, n, 'KEPT — retention-bound, see ISMS-12 §1');
      CONTINUE;
    END IF;

    q := format('orphan_quarantine.%I', r.tbl);
    IF to_regclass(q) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %s AS SELECT * FROM public.%I t WHERE t."organizationId" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = t."organizationId")',
        q, r.tbl
      );
      GET DIAGNOSTICS moved = ROW_COUNT;
      RAISE NOTICE 'quarantined % row(s) from %', moved, r.tbl;
    END IF;

    INSERT INTO cleanup_report VALUES (r.tbl, n, 'pending');
  END LOOP;

  -- Deleting in passes instead of working out an order in advance. Some of
  -- these tables point at each other, and a parent whose child still has rows
  -- fails immediately on RESTRICT. Retrying whatever failed after the others
  -- have gone lets the order emerge; the loop stops as soon as a full pass
  -- deletes nothing, so a genuinely blocked table ends the loop rather than
  -- spinning on it.
  WHILE progress AND pass < 20 LOOP
    progress := false;
    pass := pass + 1;

    FOR r IN SELECT tbl FROM cleanup_report WHERE status = 'pending' ORDER BY tbl LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM public.%I t WHERE t."organizationId" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = t."organizationId")',
          r.tbl
        );
        GET DIAGNOSTICS n = ROW_COUNT;
        UPDATE cleanup_report SET status = 'deleted', orphan_rows = n WHERE tbl = r.tbl;
        progress := true;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Another orphan table still holds the referencing rows; next pass.
        NULL;
      END;
    END LOOP;
  END LOOP;

  UPDATE cleanup_report
     SET status = 'BLOCKED — still referenced after ' || pass || ' passes'
   WHERE status = 'pending';

  RAISE NOTICE 'cleanup finished in % pass(es)', pass;
END $$;

SELECT tbl AS table_name, orphan_rows, status
  FROM cleanup_report
 ORDER BY (status LIKE 'BLOCKED%') DESC, (status LIKE 'KEPT%') DESC, orphan_rows DESC, tbl;
