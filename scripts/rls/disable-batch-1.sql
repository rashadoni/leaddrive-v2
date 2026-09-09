-- Instant rollback: RLS off for this batch. No data movement.

DROP POLICY IF EXISTS tenant_isolation ON "currencies";
ALTER TABLE "currencies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "currencies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "event_types";
ALTER TABLE "event_types" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "event_types" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "sla_policies";
ALTER TABLE "sla_policies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sla_policies" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_templates";
ALTER TABLE "task_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_templates" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "task_types";
ALTER TABLE "task_types" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "task_types" DISABLE ROW LEVEL SECURITY;
