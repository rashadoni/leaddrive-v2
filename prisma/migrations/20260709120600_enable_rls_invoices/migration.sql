-- RLS rollout — HOT (highest-traffic) tranche: enable Postgres Row-Level Security on "invoices".
-- Convention: docs/rls-rollout-plan.md + docs/rls-core-tables-runbook.md.
-- `organizationId` is NOT NULL on every row, so no data normalization is needed.
-- Non-destructive and INSTANTLY reversible (no data change):
--   ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;   -- or
--   DROP POLICY tenant_isolation ON "invoices";
--
-- ROLLOUT NOTE: apply ONE table at a time and watch [RLS-GUARD] + error rate for
-- ~a day before the next. `prisma migrate deploy` applies ALL pending migrations
-- in one shot — to keep the cadence, apply per-table SQL manually on the server
-- and record it with `prisma migrate resolve --applied <migration>` (see runbook).

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "invoices";
CREATE POLICY tenant_isolation ON "invoices"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
