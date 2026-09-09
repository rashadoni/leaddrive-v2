-- RLS rollout Phase 2 — medium-traffic table: tickets.
-- Rollback (instant, non-destructive): DROP POLICY tenant_isolation ON "tickets";
-- ALTER TABLE "tickets" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "tickets" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tickets";
CREATE POLICY tenant_isolation ON "tickets"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
