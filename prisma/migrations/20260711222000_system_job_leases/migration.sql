-- Global singleton leases for scheduled jobs.
--
-- The row is acquired with an atomic INSERT .. ON CONFLICT .. WHERE expired,
-- renewed by owner token, and completed/failed with the same token. The row is
-- retained as low-cardinality operational telemetry. It intentionally has no
-- tenant/RLS policy: cron routes are already restricted by CRON_SECRET and
-- execute inside runWithRlsBypass; the table contains no tenant data.
CREATE TABLE "system_job_leases" (
  "name" TEXT NOT NULL,
  "ownerToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'idle',
  "lastStartedAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "lastSkippedAt" TIMESTAMP(3),
  "lastFailedAt" TIMESTAMP(3),
  "lastDurationMs" INTEGER,
  "lastError" TEXT,
  "claimedCount" BIGINT NOT NULL DEFAULT 0,
  "completedCount" BIGINT NOT NULL DEFAULT 0,
  "skippedCount" BIGINT NOT NULL DEFAULT 0,
  "failedCount" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "system_job_leases_pkey" PRIMARY KEY ("name"),
  CONSTRAINT "system_job_leases_status_check"
    CHECK ("status" IN ('idle', 'running', 'completed', 'failed'))
);

CREATE INDEX "system_job_leases_leaseUntil_idx"
  ON "system_job_leases"("leaseUntil");
