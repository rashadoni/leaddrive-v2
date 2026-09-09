-- Field UX audit 2026-09-05, task A1: missing customer coordinates are NULL on
-- both axes, never 0. (0, 0) is a point in the Gulf of Guinea; stored as
-- "unknown" it reached the web route map as a marker in the ocean and the
-- field app as "6745.7 km" from Baku.
--
-- Both tables are under FORCE ROW LEVEL SECURITY and migrations run without
-- app.org_id, so a plain UPDATE would silently touch 0 rows. The backfill
-- snapshots, disables and restores the RLS flags exactly like
-- 20260705152500_monitoring_external_sources_rls_backfill.
--
-- The rows' updatedAt is bumped on purpose: mobile sync/pull deltas key on
-- it, so installed apps replace their cached 0,0 with NULL on the next sync
-- instead of keeping the ocean coordinates until a full re-login.
DO $$
DECLARE
  tbl text;
  had_rls boolean;
  had_force_rls boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['mtm_customers', 'mtm_customer_create_requests'] LOOP
    SELECT relrowsecurity, relforcerowsecurity
    INTO had_rls, had_force_rls
    FROM pg_class
    WHERE oid = tbl::regclass;

    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      'UPDATE %I SET "latitude" = NULL, "longitude" = NULL, "updatedAt" = CURRENT_TIMESTAMP
       WHERE ("latitude" = 0 AND "longitude" = 0)
          OR (("latitude" IS NULL) <> ("longitude" IS NULL))',
      tbl
    );

    IF had_rls THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    ELSE
      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
    END IF;

    IF had_force_rls THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    ELSE
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- Fail closed from now on: a pair is either fully known or fully unknown, and
-- Null Island is never a customer location. Application code normalizes
-- before writing (src/lib/mtm/geo-coordinates.ts); the constraint catches
-- scripts and future writers that bypass it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mtm_customers_coordinates_check') THEN
    ALTER TABLE "mtm_customers"
      ADD CONSTRAINT "mtm_customers_coordinates_check" CHECK (
        ("latitude" IS NULL AND "longitude" IS NULL)
        OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND NOT ("latitude" = 0 AND "longitude" = 0))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mtm_customer_create_requests_coordinates_check') THEN
    ALTER TABLE "mtm_customer_create_requests"
      ADD CONSTRAINT "mtm_customer_create_requests_coordinates_check" CHECK (
        ("latitude" IS NULL AND "longitude" IS NULL)
        OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND NOT ("latitude" = 0 AND "longitude" = 0))
      );
  END IF;
END $$;
