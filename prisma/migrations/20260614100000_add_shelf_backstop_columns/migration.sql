-- Variant C (durable shelf-scan backstop): give MtmShelfAnalysis the columns the
-- Postgres-cron sweep needs to retry a sync Claude scan that failed mid-flight,
-- plus an idempotency key so a phone re-POSTing a timed-out capture converges on
-- one row instead of spawning duplicates.

-- AlterEnum
--   AWAITING_BACKSTOP = persisted-but-not-yet-analyzed, distinct from PENDING
--   (= queued, never attempted). Safe inside the migration transaction: the new
--   value is only ADDED here, never consumed by an INSERT/UPDATE in the same tx
--   (Postgres forbids using a freshly-added enum value within its own tx, not
--   adding it). IF NOT EXISTS makes re-apply a no-op.
ALTER TYPE "MtmShelfAnalysisStatus" ADD VALUE IF NOT EXISTS 'AWAITING_BACKSTOP';

-- AlterTable
ALTER TABLE "mtm_shelf_analyses"
  ADD COLUMN "clientScanId" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN "lockedAt" TIMESTAMP(3);

-- CreateIndex
--   Backstop sweep hot path: WHERE status = 'AWAITING_BACKSTOP' AND nextRetryAt <= now()
CREATE INDEX "mtm_shelf_analyses_status_nextRetryAt_idx"
  ON "mtm_shelf_analyses"("status", "nextRetryAt");

-- CreateIndex
--   Idempotency lookup by (org, clientScanId)
CREATE INDEX "mtm_shelf_analyses_organizationId_clientScanId_idx"
  ON "mtm_shelf_analyses"("organizationId", "clientScanId");

-- CreateIndex
--   Idempotency GUARANTEE: a (org, clientScanId) pair can exist at most once, so a
--   retried POST can't create a second analysis row. Partial — NULL clientScanId
--   (legacy rows, web-origin scans that never send one) is exempt and unconstrained.
--   Prisma's schema can't express a partial-unique, so this index is raw-SQL only
--   and intentionally NOT mirrored by an @@unique in schema.prisma.
CREATE UNIQUE INDEX "mtm_shelf_analyses_org_clientScanId_unique"
  ON "mtm_shelf_analyses"("organizationId", "clientScanId")
  WHERE "clientScanId" IS NOT NULL;
