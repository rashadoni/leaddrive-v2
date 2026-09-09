-- M4-2: Composite indexes for MTM analytics hot-path queries
--
-- Adds composite indexes identified by the k6 load test (M4-1) as the
-- bottlenecks for the three heaviest query patterns under 351 concurrent users:
--
--   1. MtmShelfAnalysis supervisor analytics — WHERE orgId + status + completedAt
--      range + ORDER BY completedAt. Currently forces a full org-table seq scan
--      because the three separate single-column indexes cannot be combined for
--      the sort. Expected to fix supervisor poll P95 from >500 ms → <500 ms.
--
--   2. MtmShelfAnalysis planogramId compliance JOIN — lookups across all analyses
--      for a given planogram (compliance report). Currently no index on planogramId.
--
--   3. MtmVisit date-range analytics — date-range queries per org + agent +
--      date-range scans. Adds two composites for the two hot paths.
--
--   4. MtmAgentLocation "latest location per agent" — WHERE agentId ORDER BY
--      recordedAt DESC LIMIT 1. The individual agentId and recordedAt indexes
--      cannot serve this query together; a composite index covers both.
--
--   5. MtmAgentLocation live-map range — WHERE orgId + agentId + recordedAt range.
--
--   6. MtmPhoto analytics date-range — WHERE orgId + createdAt.
--
-- All statements use CREATE INDEX IF NOT EXISTS — idempotent on DBs where the
-- index already exists (e.g. applied manually or via db push during development).

-- ── MtmShelfAnalysis (mtm_shelf_analyses) ────────────────────────────────────

-- Supervisor analytics hot path:
--   SELECT ... FROM mtm_shelf_analyses
--   WHERE "organizationId" = ? AND "status" = 'COMPLETED'
--     AND "completedAt" >= ? AND "completedAt" <= ?
--   ORDER BY "completedAt" DESC
--   LIMIT 50 OFFSET 0
-- Index covers the equality + range filter AND the ORDER BY → avoids filesort.
CREATE INDEX IF NOT EXISTS "mtm_shelf_analyses_organizationId_status_completedAt_idx"
  ON "mtm_shelf_analyses" ("organizationId", "status", "completedAt");

-- Compliance JOIN: SELECT ... FROM mtm_shelf_analyses WHERE "planogramId" = ?
-- Used in compliance-score reports and in the M3-3b auto-match path.
CREATE INDEX IF NOT EXISTS "mtm_shelf_analyses_planogramId_idx"
  ON "mtm_shelf_analyses" ("planogramId");

-- ── MtmVisit (mtm_visits) ─────────────────────────────────────────────────────

-- Agent visit history dashboard:
--   WHERE "organizationId" = ? AND "agentId" = ?
--   ORDER BY "checkInAt" DESC
-- Leftmost prefix also serves single-column orgId and agentId lookups.
CREATE INDEX IF NOT EXISTS "mtm_visits_organizationId_agentId_checkInAt_idx"
  ON "mtm_visits" ("organizationId", "agentId", "checkInAt");

-- Analytics date-range scan across org:
--   WHERE "organizationId" = ? AND "createdAt" >= ? AND "createdAt" <= ?
-- Covers supervisor visit-count and revenue aggregates.
CREATE INDEX IF NOT EXISTS "mtm_visits_organizationId_createdAt_idx"
  ON "mtm_visits" ("organizationId", "createdAt");

-- ── MtmAgentLocation (mtm_agent_locations) ───────────────────────────────────

-- "Latest GPS location per agent" — called on every location update to display
-- agent positions on the dashboard map:
--   WHERE "agentId" = ? ORDER BY "recordedAt" DESC LIMIT 1
-- Without this composite, Postgres must scan all rows for the agentId and then
-- sort. With it, the backward index scan returns row 1 immediately.
CREATE INDEX IF NOT EXISTS "mtm_agent_locations_agentId_recordedAt_idx"
  ON "mtm_agent_locations" ("agentId", "recordedAt");

-- Supervisor live-map date-range: WHERE "organizationId" = ? AND "agentId" = ?
--   AND "recordedAt" >= ? AND "recordedAt" <= ?
-- Used for the "agent path replay" and historical location analytics views.
CREATE INDEX IF NOT EXISTS "mtm_agent_locations_organizationId_agentId_recordedAt_idx"
  ON "mtm_agent_locations" ("organizationId", "agentId", "recordedAt");

-- ── MtmPhoto (mtm_photos) ─────────────────────────────────────────────────────

-- Photo analytics date-range:
--   WHERE "organizationId" = ? AND "createdAt" >= ? AND "createdAt" <= ?
-- Covers photo-count KPI and supervisor photo gallery pagination.
CREATE INDEX IF NOT EXISTS "mtm_photos_organizationId_createdAt_idx"
  ON "mtm_photos" ("organizationId", "createdAt");
