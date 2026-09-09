-- RLS rollout Phase 2 — medium-traffic table: companies.
-- Rollback (instant, non-destructive): DROP POLICY tenant_isolation ON "companies";
-- ALTER TABLE "companies" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "companies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "companies";
CREATE POLICY tenant_isolation ON "companies"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
