-- Normalise the 14 hand-written MTM tenant_isolation policies to the generator dialect.
--
-- THE BUG: these policies predate the `app.rls_bypass` escape hatch, so their
-- USING/WITH CHECK read only
--   "organizationId" = current_setting('app.org_id', true)
-- while scripts/rls/generate-rls-policies.mjs — and every migration written since
-- 20260711234000_social_monitoring_rls_bypass_hardening — emits
--   ... OR current_setting('app.rls_bypass', true) = 'on'
-- Verified on production 2026-08-06: all 14 policies have polqual AND polwithcheck
-- without the bypass branch, and the app role `hermes` is neither the table owner
-- (leaddrive_migrator) nor rolbypassrls — so the policy really does apply to it.
--
-- IMPACT: runWithRlsBypass() in src/lib/rls-context.ts sets app.rls_bypass='on';
-- on these 14 tables that had no effect. RLS is fail-closed, so a bypass-scoped
-- SELECT/DELETE silently matched zero rows and a bypass-scoped INSERT/UPDATE
-- failed WITH CHECK. The one live consumer is clearTenantContent()
-- (src/lib/tenant-provisioning.ts, POST /api/v1/admin/tenants/[id]/clear-demo),
-- which raw-DELETEs from every organizationId table under bypass: on these 14 the
-- DELETE matched 0 rows, the fix-point loop counted that as progress, and the
-- purge reported success while leaving rows behind. Everything else that reaches
-- these tables (33 mtm/** routes) runs under withMobileRls/withRlsAuth, i.e.
-- runWithTenant — tenant-scoped, so unaffected either way.
--
-- Shape and NAME follow 20260806120000_mtm_rls_coverage_completion: the bare
-- `tenant_isolation` is what scripts/rls/disable-batch-*.sql drops, so keeping the
-- old `<table>_tenant_isolation` name would leave the emergency rollback path
-- unable to lift these policies. Both names are dropped first so no table ends up
-- carrying two policies — Postgres ORs multiple PERMISSIVE policies together, so a
-- leftover old policy would not have blocked anything, but it would have left two
-- contradictory definitions of tenant isolation on the same table.
--
-- Idempotent: DROP ... IF EXISTS + CREATE, and the ENABLE/FORCE lines are no-ops
-- everywhere except mtm_doctor_scoring_formulas / mtm_doctor_assessments, which
-- were ENABLEd but never FORCEd (TABLES_MISSING_FORCE in
-- src/__tests__/mtm-rls-coverage.test.ts). Those two are repaired here rather than
-- earlier because FORCE subjects the table OWNER to the policy: adding it while
-- the policy still lacked the bypass clause would have left owner-run maintenance
-- with no hatch at all. `prisma migrate deploy` itself is unaffected either way —
-- leaddrive_migrator holds rolbypassrls.

SET lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Workdays / GPS (20260715234500_mtm_mobile_workdays_gps_idempotency)
-- ---------------------------------------------------------------------------

ALTER TABLE "mtm_agent_workdays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_workdays" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_workdays";
DROP POLICY IF EXISTS "mtm_agent_workdays_tenant_isolation" ON "mtm_agent_workdays";
CREATE POLICY tenant_isolation ON "mtm_agent_workdays"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_agent_workday_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_agent_workday_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_agent_workday_events";
DROP POLICY IF EXISTS "mtm_agent_workday_events_tenant_isolation" ON "mtm_agent_workday_events";
CREATE POLICY tenant_isolation ON "mtm_agent_workday_events"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- Task workflow (20260716003000_mtm_mobile_task_workflow)
-- ---------------------------------------------------------------------------

ALTER TABLE "mtm_task_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_task_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_task_events";
DROP POLICY IF EXISTS "mtm_task_events_tenant_isolation" ON "mtm_task_events";
CREATE POLICY tenant_isolation ON "mtm_task_events"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- Commitments (20260716043000_mtm_commitment_events)
-- ---------------------------------------------------------------------------

ALTER TABLE "mtm_commitments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_commitments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_commitments";
DROP POLICY IF EXISTS "mtm_commitments_tenant_isolation" ON "mtm_commitments";
CREATE POLICY tenant_isolation ON "mtm_commitments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_commitment_fulfillments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_commitment_fulfillments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_commitment_fulfillments";
DROP POLICY IF EXISTS "mtm_commitment_fulfillments_tenant_isolation" ON "mtm_commitment_fulfillments";
CREATE POLICY tenant_isolation ON "mtm_commitment_fulfillments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- Messages / documents / HRM (20260716070000_mtm_mobile_messages_documents_hrm)
-- ---------------------------------------------------------------------------

ALTER TABLE "mtm_message_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_threads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_message_threads";
DROP POLICY IF EXISTS "mtm_message_threads_tenant_isolation" ON "mtm_message_threads";
CREATE POLICY tenant_isolation ON "mtm_message_threads"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_message_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_participants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_message_participants";
DROP POLICY IF EXISTS "mtm_message_participants_tenant_isolation" ON "mtm_message_participants";
CREATE POLICY tenant_isolation ON "mtm_message_participants"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_messages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_messages";
DROP POLICY IF EXISTS "mtm_messages_tenant_isolation" ON "mtm_messages";
CREATE POLICY tenant_isolation ON "mtm_messages"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_message_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_receipts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_message_receipts";
DROP POLICY IF EXISTS "mtm_message_receipts_tenant_isolation" ON "mtm_message_receipts";
CREATE POLICY tenant_isolation ON "mtm_message_receipts"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_documents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_documents";
DROP POLICY IF EXISTS "mtm_documents_tenant_isolation" ON "mtm_documents";
CREATE POLICY tenant_isolation ON "mtm_documents"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_document_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_document_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_document_assignments";
DROP POLICY IF EXISTS "mtm_document_assignments_tenant_isolation" ON "mtm_document_assignments";
CREATE POLICY tenant_isolation ON "mtm_document_assignments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_hrm_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_hrm_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_hrm_requests";
DROP POLICY IF EXISTS "mtm_hrm_requests_tenant_isolation" ON "mtm_hrm_requests";
CREATE POLICY tenant_isolation ON "mtm_hrm_requests"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- Doctor scoring (20260722050000_mtm_doctor_pharma_scoring)
-- These two also gain FORCE — see the header note on why it waited for the
-- bypass clause.
-- ---------------------------------------------------------------------------

ALTER TABLE "mtm_doctor_scoring_formulas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_doctor_scoring_formulas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_doctor_scoring_formulas";
DROP POLICY IF EXISTS "mtm_doctor_scoring_formulas_tenant_isolation" ON "mtm_doctor_scoring_formulas";
CREATE POLICY tenant_isolation ON "mtm_doctor_scoring_formulas"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

ALTER TABLE "mtm_doctor_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_doctor_assessments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mtm_doctor_assessments";
DROP POLICY IF EXISTS "mtm_doctor_assessments_tenant_isolation" ON "mtm_doctor_assessments";
CREATE POLICY tenant_isolation ON "mtm_doctor_assessments"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
