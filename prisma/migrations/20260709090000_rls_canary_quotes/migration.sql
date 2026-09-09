-- RLS rollout Phase 1 — canary table (low-traffic): quotes.
-- Rollback (instant, non-destructive): DROP POLICY tenant_isolation ON "quotes";
-- ALTER TABLE "quotes" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "quotes" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "quotes";
CREATE POLICY tenant_isolation ON "quotes"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
