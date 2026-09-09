-- Close the MTM RLS coverage gap.
--
-- 33 tenant-scoped mtm_* tables reach FORCE ROW LEVEL SECURITY here:
--
--   1a (17) — carry organizationId but had no RLS statement anywhere. 12 of them
--             were enabled by hand on production; 5 were genuinely unprotected.
--   1b (15) — core tables (agents, customers, visits, tasks, photos, audit logs…)
--             that ARE protected on production, but only because
--             scripts/rls/enable-batch-*.sql was run by hand. No migration ever
--             enabled them, so a database built from prisma/migrations alone —
--             CI, a restored staging box, a new region — had them wide open.
--   2  (1)  — mtm_route_points, which first needs organizationId denormalised
--             from its parent route.
--
-- Every statement is idempotent: on production this is a no-op except for the 5
-- unprotected tables and mtm_route_points.
--
-- Policy shape: the `app.rls_bypass` escape hatch is REQUIRED. runWithRlsBypass()
-- in src/lib/rls-context.ts sets `app.rls_bypass = 'on'` and is used by 400+ call
-- sites; a tenant_isolation policy without that OR-clause silently returns zero
-- rows to every one of them. 14 older MTM policies written by hand omit it — see
-- POLICIES_MISSING_BYPASS_CLAUSE in src/__tests__/mtm-rls-coverage.test.ts.
--
-- Policy NAME is the bare `tenant_isolation`, matching what
-- scripts/rls/generate-rls-policies.mjs emits and — critically — what
-- scripts/rls/disable-batch-*.sql drops. Naming these `<table>_tenant_isolation`
-- (the dialect some hand-written migrations use) would silently break that
-- emergency rollback path. Both names are dropped first so no table ends up with
-- two permissive policies.

SET lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. The 32 tenant tables that already carry organizationId.
-- ---------------------------------------------------------------------------

-- 1a. Tenant tables with organizationId that had no RLS statement at all.

ALTER TABLE "mtm_contact_assignment_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_assignment_operations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_assignment_operations";
DROP POLICY IF EXISTS "mtm_contact_assignment_operations_tenant_isolation" ON "mtm_contact_assignment_operations";
CREATE POLICY tenant_isolation ON "mtm_contact_assignment_operations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_contact_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_change_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_change_requests";
DROP POLICY IF EXISTS "mtm_contact_change_requests_tenant_isolation" ON "mtm_contact_change_requests";
CREATE POLICY tenant_isolation ON "mtm_contact_change_requests"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_contact_transfer_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_contact_transfer_operations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_contact_transfer_operations";
DROP POLICY IF EXISTS "mtm_contact_transfer_operations_tenant_isolation" ON "mtm_contact_transfer_operations";
CREATE POLICY tenant_isolation ON "mtm_contact_transfer_operations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_customer_create_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customer_create_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_customer_create_requests";
DROP POLICY IF EXISTS "mtm_customer_create_requests_tenant_isolation" ON "mtm_customer_create_requests";
CREATE POLICY tenant_isolation ON "mtm_customer_create_requests"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_external_sales_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_external_sales_documents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_external_sales_documents";
DROP POLICY IF EXISTS "mtm_external_sales_documents_tenant_isolation" ON "mtm_external_sales_documents";
CREATE POLICY tenant_isolation ON "mtm_external_sales_documents"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_external_sales_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_external_sales_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_external_sales_lines";
DROP POLICY IF EXISTS "mtm_external_sales_lines_tenant_isolation" ON "mtm_external_sales_lines";
CREATE POLICY tenant_isolation ON "mtm_external_sales_lines"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_import_jobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_import_jobs";
DROP POLICY IF EXISTS "mtm_import_jobs_tenant_isolation" ON "mtm_import_jobs";
CREATE POLICY tenant_isolation ON "mtm_import_jobs"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_import_row_errors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_import_row_errors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_import_row_errors";
DROP POLICY IF EXISTS "mtm_import_row_errors_tenant_isolation" ON "mtm_import_row_errors";
CREATE POLICY tenant_isolation ON "mtm_import_row_errors"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_organization_assignment_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_organization_assignment_operations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_organization_assignment_operations";
DROP POLICY IF EXISTS "mtm_organization_assignment_operations_tenant_isolation" ON "mtm_organization_assignment_operations";
CREATE POLICY tenant_isolation ON "mtm_organization_assignment_operations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_route_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_assignments";
DROP POLICY IF EXISTS "mtm_route_assignments_tenant_isolation" ON "mtm_route_assignments";
CREATE POLICY tenant_isolation ON "mtm_route_assignments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_route_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_change_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_change_requests";
DROP POLICY IF EXISTS "mtm_route_change_requests_tenant_isolation" ON "mtm_route_change_requests";
CREATE POLICY tenant_isolation ON "mtm_route_change_requests"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_action_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_action_results" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_action_results";
DROP POLICY IF EXISTS "mtm_visit_action_results_tenant_isolation" ON "mtm_visit_action_results";
CREATE POLICY tenant_isolation ON "mtm_visit_action_results"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_participants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_participants";
DROP POLICY IF EXISTS "mtm_visit_participants_tenant_isolation" ON "mtm_visit_participants";
CREATE POLICY tenant_isolation ON "mtm_visit_participants"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_policies";
DROP POLICY IF EXISTS "mtm_visit_policies_tenant_isolation" ON "mtm_visit_policies";
CREATE POLICY tenant_isolation ON "mtm_visit_policies"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_policy_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_policy_actions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_policy_actions";
DROP POLICY IF EXISTS "mtm_visit_policy_actions_tenant_isolation" ON "mtm_visit_policy_actions";
CREATE POLICY tenant_isolation ON "mtm_visit_policy_actions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_requirement_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_requirement_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_requirement_snapshots";
DROP POLICY IF EXISTS "mtm_visit_requirement_snapshots_tenant_isolation" ON "mtm_visit_requirement_snapshots";
CREATE POLICY tenant_isolation ON "mtm_visit_requirement_snapshots"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visit_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visit_requirements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visit_requirements";
DROP POLICY IF EXISTS "mtm_visit_requirements_tenant_isolation" ON "mtm_visit_requirements";
CREATE POLICY tenant_isolation ON "mtm_visit_requirements"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- 1b. Core MTM tables that DO have RLS on production, but only because
--     scripts/rls/enable-batch-*.sql was run by hand. No migration ever enabled
--     them, so any database built from prisma/migrations alone — CI, a restored
--     staging box, a new region — has had these wide open. No-op on production.

ALTER TABLE "mtm_agent_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_locations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_locations";
DROP POLICY IF EXISTS "mtm_agent_locations_tenant_isolation" ON "mtm_agent_locations";
CREATE POLICY tenant_isolation ON "mtm_agent_locations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_agents";
DROP POLICY IF EXISTS "mtm_agents_tenant_isolation" ON "mtm_agents";
CREATE POLICY tenant_isolation ON "mtm_agents"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_alerts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_alerts";
DROP POLICY IF EXISTS "mtm_alerts_tenant_isolation" ON "mtm_alerts";
CREATE POLICY tenant_isolation ON "mtm_alerts"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_audit_logs";
DROP POLICY IF EXISTS "mtm_audit_logs_tenant_isolation" ON "mtm_audit_logs";
CREATE POLICY tenant_isolation ON "mtm_audit_logs"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_customers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_customers";
DROP POLICY IF EXISTS "mtm_customers_tenant_isolation" ON "mtm_customers";
CREATE POLICY tenant_isolation ON "mtm_customers"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_notifications";
DROP POLICY IF EXISTS "mtm_notifications_tenant_isolation" ON "mtm_notifications";
CREATE POLICY tenant_isolation ON "mtm_notifications"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_onboarding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_onboarding" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_onboarding";
DROP POLICY IF EXISTS "mtm_onboarding_tenant_isolation" ON "mtm_onboarding";
CREATE POLICY tenant_isolation ON "mtm_onboarding"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_photos" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_photos";
DROP POLICY IF EXISTS "mtm_photos_tenant_isolation" ON "mtm_photos";
CREATE POLICY tenant_isolation ON "mtm_photos"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_regions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_regions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_regions";
DROP POLICY IF EXISTS "mtm_regions_tenant_isolation" ON "mtm_regions";
CREATE POLICY tenant_isolation ON "mtm_regions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_settings";
DROP POLICY IF EXISTS "mtm_settings_tenant_isolation" ON "mtm_settings";
CREATE POLICY tenant_isolation ON "mtm_settings"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_sync_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_sync_operations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_sync_operations";
DROP POLICY IF EXISTS "mtm_sync_operations_tenant_isolation" ON "mtm_sync_operations";
CREATE POLICY tenant_isolation ON "mtm_sync_operations"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_tasks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_tasks";
DROP POLICY IF EXISTS "mtm_tasks_tenant_isolation" ON "mtm_tasks";
CREATE POLICY tenant_isolation ON "mtm_tasks"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_teams" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_teams";
DROP POLICY IF EXISTS "mtm_teams_tenant_isolation" ON "mtm_teams";
CREATE POLICY tenant_isolation ON "mtm_teams"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_visits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_visits";
DROP POLICY IF EXISTS "mtm_visits_tenant_isolation" ON "mtm_visits";
CREATE POLICY tenant_isolation ON "mtm_visits"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_routes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_routes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_routes";
DROP POLICY IF EXISTS "mtm_routes_tenant_isolation" ON "mtm_routes";
CREATE POLICY tenant_isolation ON "mtm_routes"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- 2. mtm_route_points — denormalise organizationId from the parent route.
-- ---------------------------------------------------------------------------
--
-- MtmRoutePoint was the only MTM child table with no organizationId, so it could
-- not carry the standard policy. Its sibling under the same parent,
-- MtmRouteAssignment, already denormalises organizationId, so this follows the
-- established convention rather than inventing a parent-subquery policy. The
-- alternative (USING EXISTS (SELECT 1 FROM mtm_routes ...)) was rejected: it
-- costs a parent index lookup per row on hot KPI/leaderboard scans, and it would
-- have left one table policed differently from all 68 others.

ALTER TABLE "mtm_route_points" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- Backfill through forced RLS. Migrations run without app.org_id set, so a plain
-- UPDATE joining mtm_routes sees zero rows on production, where mtm_routes is
-- under FORCE RLS. Snapshot/disable/restore per the house rule in CLAUDE.md
-- (pattern: 20260705152500_monitoring_external_sources_rls_backfill).
DO $$
DECLARE
  had_rls boolean;
  had_force_rls boolean;
  orphan_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity
  INTO had_rls, had_force_rls
  FROM pg_class
  WHERE oid = 'mtm_routes'::regclass;

  ALTER TABLE "mtm_routes" DISABLE ROW LEVEL SECURITY;

  UPDATE "mtm_route_points" AS p
  SET "organizationId" = r."organizationId"
  FROM "mtm_routes" AS r
  WHERE r."id" = p."routeId"
    AND p."organizationId" IS DISTINCT FROM r."organizationId";

  SELECT count(*) INTO orphan_count
  FROM "mtm_route_points"
  WHERE "organizationId" IS NULL;

  -- Restore before the fail-safe, so an orphan row cannot leave RLS off.
  IF had_rls THEN
    ALTER TABLE "mtm_routes" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF had_force_rls THEN
    ALTER TABLE "mtm_routes" FORCE ROW LEVEL SECURITY;
  END IF;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'mtm_route_points backfill left % row(s) with NULL organizationId (route missing?) — refusing to add NOT NULL', orphan_count;
  END IF;
END $$;

ALTER TABLE "mtm_route_points" ALTER COLUMN "organizationId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mtm_route_points_organizationId_fkey'
  ) THEN
    ALTER TABLE "mtm_route_points"
      ADD CONSTRAINT "mtm_route_points_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "mtm_route_points_organizationId_idx"
  ON "mtm_route_points" ("organizationId");

ALTER TABLE "mtm_route_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_route_points" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_route_points";
DROP POLICY IF EXISTS "mtm_route_points_tenant_isolation" ON "mtm_route_points";
CREATE POLICY tenant_isolation ON "mtm_route_points"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
