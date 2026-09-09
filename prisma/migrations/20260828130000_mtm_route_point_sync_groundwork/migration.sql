-- R6: give every route point its own sync revision and mutation timestamp.
--
-- This is additive. Existing soft-deleted rows retain their deletedAt value and
-- receive a baseline version/timestamp, so they remain honest tombstones rather
-- than disappearing. `mtm_route_points` already has FORCE RLS and its live
-- tenant_isolation policy; this migration adds no new tenant table or policy.
--
-- Rollback is forward-safe: stop any future v2 route-point reader and roll back
-- application code, but retain these additive columns and indexes. Dropping them
-- would erase revisions needed to reconcile an offline device.

SET lock_timeout = '3s';

ALTER TABLE "mtm_route_points"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Prisma owns @updatedAt for normal writes. The database default exists solely
-- to backfill pre-R6 rows and to make raw/import creation safe.
CREATE INDEX "mtm_route_points_org_route_order_idx"
  ON "mtm_route_points"("organizationId", "routeId", "orderIndex");
CREATE INDEX "mtm_route_points_org_updated_id_idx"
  ON "mtm_route_points"("organizationId", "updatedAt", "id");
