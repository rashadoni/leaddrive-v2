-- Field UX audit 2026-09-05, task A3.
--
-- A route that was never finished stayed IN_PROGRESS for ever, so the web
-- "Davam edir" (in progress) list showed fourteen routes from August next to
-- today's work and the agent's week screen kept offering to continue days that
-- ended weeks ago. INCOMPLETE names that outcome without pretending the route
-- was cancelled: progress (visitedPoints, startedAt, visits) is preserved.
--
-- AlterEnum only. Postgres forbids USING a freshly added enum value inside the
-- transaction that adds it, so the historical rows are not rewritten here — the
-- mtm-route-day-close job closes them on its first run, per organization and in
-- that organization's own timezone. IF NOT EXISTS keeps a re-apply a no-op.
--
-- The value is placed before CANCELLED so the enum's sort order still reads as
-- the route lifecycle. Existing rows are untouched by an ADD VALUE, and no RLS
-- policy references the enum, so the DO-block snapshot/disable/restore dance
-- required for backfills does not apply.
ALTER TYPE "MtmRouteStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE' BEFORE 'CANCELLED';

-- CreateIndex
--   The hourly sweep asks each tenant "which of your past days are still open?"
--   (organizationId = ? AND status IN (...) AND date < ?). The table only had
--   single-column indexes on organizationId and date, so that question cost a
--   scan per tenant per hour. CONCURRENTLY is deliberately NOT used: Prisma runs
--   each migration inside a transaction, which forbids it, and this table is
--   small enough that the brief lock is cheaper than an out-of-band build.
CREATE INDEX IF NOT EXISTS "mtm_routes_organizationId_status_date_idx"
  ON "mtm_routes"("organizationId", "status", "date");
