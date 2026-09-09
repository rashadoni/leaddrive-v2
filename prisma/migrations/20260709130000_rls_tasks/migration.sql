-- RLS rollout Phase 2 — medium-traffic table: tasks (second canary-tier table).
-- Rollback (instant, non-destructive): DROP POLICY tenant_isolation ON "tasks";
-- ALTER TABLE "tasks" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "tasks" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tasks";
CREATE POLICY tenant_isolation ON "tasks"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
