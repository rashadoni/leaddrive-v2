-- Bounded, tenant-fair retention for rebuildable mobile-sync v2 pull state.
--
-- This is additive. It never alters protocol v1, mtm_sync_operations or the
-- Field mutation outbox. Rollback is operational: disable the scheduler or
-- roll back the caller; do not lower a retention floor or recreate deleted
-- journal/cache rows, because a controlled v2 resnapshot is safer than a
-- fabricated cursor history.

SET lock_timeout = '3s';

-- An opaque round-robin cursor is global scheduling state, not tenant data.
-- Keep it separate from system_job_leases: that table provides the singleton
-- cron lease and heartbeat, while this table must be invisible to every
-- tenant-scoped application request.
CREATE TABLE "mtm_mobile_sync_retention_cursors" (
  "jobName" TEXT NOT NULL,
  "lastOrganizationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mtm_mobile_sync_retention_cursors_pkey" PRIMARY KEY ("jobName"),
  CONSTRAINT "mtm_mobile_sync_retention_cursors_job_name_length"
    CHECK (char_length("jobName") BETWEEN 1 AND 64)
);

-- Schema-before-code: each bounded job must have a durable cursor row. The
-- runtime fails closed rather than falling back to an unbounded global scan
-- when one of these rows is unexpectedly absent.
INSERT INTO "mtm_mobile_sync_retention_cursors" ("jobName") VALUES
  ('changes'),
  ('snapshots'),
  ('leases')
ON CONFLICT ("jobName") DO NOTHING;

ALTER TABLE "mtm_mobile_sync_retention_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_mobile_sync_retention_cursors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mtm_mobile_sync_retention_cursor_bypass_only
  ON "mtm_mobile_sync_retention_cursors";
CREATE POLICY mtm_mobile_sync_retention_cursor_bypass_only
  ON "mtm_mobile_sync_retention_cursors"
  USING (current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

-- Do not add ordinary indexes to already-live v2 cache tables here. The
-- exact CREATE INDEX CONCURRENTLY commands and verification/rollback fence are
-- documented in docs/mobile-sync-v2-rollout-runbook.md; running them inside a
-- transactional Prisma migration could block Field traffic.
