-- Close the last two known cross-tenant child tables: offer_items and
-- deal_competitors (findings F-55 and F-56, docs/isms/ISMS-02-gap-analysis.md).
--
-- Both were invisible to scripts/rls/verify-coverage.mjs, which defines a tenant
-- table as one carrying an `organizationId` column. Neither did, so neither was
-- ever counted, checked or reported — and their isolation rested entirely on
-- each caller remembering to filter through the parent. Two callers did not:
--
--   * offers/[id] PUT ran deleteMany + createMany on offer_items BEFORE the
--     ownership check, so a PUT against another tenant's offer destroyed or
--     forged that offer's line items and only then returned 404;
--   * deals/[id]/competitors DELETE passed a body-supplied competitorId
--     straight to delete({ where: { id } }) with no dealId constraint.
--
-- Denormalising organizationId follows the convention already set by
-- MtmRoutePoint (20260806120000_mtm_rls_coverage_completion, section 2). The
-- alternative — a policy with USING EXISTS (SELECT 1 FROM offers ...) — was
-- rejected there and is rejected here for the same reasons: a parent index
-- lookup per row on every read, and one table policed differently from all the
-- others.
--
-- Idempotent throughout: safe to re-run, and a no-op on a database that already
-- has the column.

SET lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. offer_items — denormalise organizationId from the parent offer.
-- ---------------------------------------------------------------------------

ALTER TABLE "offer_items" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- Backfill through forced RLS. Migrations run with no app.org_id set, and
-- "offers" is under FORCE ROW LEVEL SECURITY on production, so a plain UPDATE
-- joining it matches ZERO rows and would silently leave an all-NULL column —
-- which the SET NOT NULL below would then reject, or worse, would not if the
-- table happened to be empty. Snapshot/disable/restore per the house rule in
-- CLAUDE.md (pattern: 20260705152500_monitoring_external_sources_rls_backfill).
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  orphan_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'offers'::regclass;

  ALTER TABLE "offers" DISABLE ROW LEVEL SECURITY;

  UPDATE "offer_items" AS oi
  SET "organizationId" = o."organizationId"
  FROM "offers" AS o
  WHERE o."id" = oi."offerId"
    AND oi."organizationId" IS DISTINCT FROM o."organizationId";

  SELECT count(*) INTO orphan_count
  FROM "offer_items"
  WHERE "organizationId" IS NULL;

  -- Restore BEFORE the fail-safe, so an orphan row cannot leave the parent
  -- table with RLS switched off.
  IF had_rls THEN
    ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF had_force_rls THEN
    ALTER TABLE "offers" FORCE ROW LEVEL SECURITY;
  END IF;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'offer_items backfill left % row(s) with NULL organizationId (parent offer missing?) — refusing to add NOT NULL', orphan_count;
  END IF;
END $$;

ALTER TABLE "offer_items" ALTER COLUMN "organizationId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'offer_items_organizationId_fkey'
  ) THEN
    ALTER TABLE "offer_items"
      ADD CONSTRAINT "offer_items_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "offer_items_organizationId_idx"
  ON "offer_items" ("organizationId");

ALTER TABLE "offer_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offer_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "offer_items";
DROP POLICY IF EXISTS "offer_items_tenant_isolation" ON "offer_items";
CREATE POLICY tenant_isolation ON "offer_items"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- 2. deal_competitors — denormalise organizationId from the parent deal.
-- ---------------------------------------------------------------------------

ALTER TABLE "deal_competitors" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  orphan_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'deals'::regclass;

  ALTER TABLE "deals" DISABLE ROW LEVEL SECURITY;

  UPDATE "deal_competitors" AS dc
  SET "organizationId" = d."organizationId"
  FROM "deals" AS d
  WHERE d."id" = dc."dealId"
    AND dc."organizationId" IS DISTINCT FROM d."organizationId";

  SELECT count(*) INTO orphan_count
  FROM "deal_competitors"
  WHERE "organizationId" IS NULL;

  IF had_rls THEN
    ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF had_force_rls THEN
    ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;
  END IF;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'deal_competitors backfill left % row(s) with NULL organizationId (parent deal missing?) — refusing to add NOT NULL', orphan_count;
  END IF;
END $$;

ALTER TABLE "deal_competitors" ALTER COLUMN "organizationId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_competitors_organizationId_fkey'
  ) THEN
    ALTER TABLE "deal_competitors"
      ADD CONSTRAINT "deal_competitors_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "deal_competitors_organizationId_idx"
  ON "deal_competitors" ("organizationId");

ALTER TABLE "deal_competitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_competitors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "deal_competitors";
DROP POLICY IF EXISTS "deal_competitors_tenant_isolation" ON "deal_competitors";
CREATE POLICY tenant_isolation ON "deal_competitors"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
