-- RLS rollout Phase 2 — medium-traffic table: leads.
-- Rollback (instant, non-destructive): DROP POLICY tenant_isolation ON "leads";
-- ALTER TABLE "leads" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "leads" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "leads";
CREATE POLICY tenant_isolation ON "leads"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
