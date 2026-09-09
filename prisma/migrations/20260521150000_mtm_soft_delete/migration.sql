-- M2-1d: Soft delete support for offline sync delta pull
-- Adds deletedAt column to 6 agent-scoped MTM models.
-- Hard deletes on these tables should be replaced with UPDATE SET deletedAt = NOW().
-- Sync pull returns deleted record IDs via `deleted[]` array for client-side eviction.

ALTER TABLE "mtm_customers"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "mtm_routes"       ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "mtm_route_points" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "mtm_visits"       ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "mtm_tasks"        ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "mtm_orders"       ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Partial indexes to speed up deletedAt IS NULL queries (active records only)
CREATE INDEX "mtm_customers_deletedAt_idx"    ON "mtm_customers"    ("deletedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX "mtm_routes_deletedAt_idx"       ON "mtm_routes"       ("deletedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX "mtm_route_points_deletedAt_idx" ON "mtm_route_points" ("deletedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX "mtm_visits_deletedAt_idx"       ON "mtm_visits"       ("deletedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX "mtm_tasks_deletedAt_idx"        ON "mtm_tasks"        ("deletedAt") WHERE "deletedAt" IS NULL;
CREATE INDEX "mtm_orders_deletedAt_idx"       ON "mtm_orders"       ("deletedAt") WHERE "deletedAt" IS NULL;
