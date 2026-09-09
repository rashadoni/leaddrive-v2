-- M2-1b: MtmSyncOperation for offline sync idempotency

CREATE TABLE "mtm_sync_operations" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId"        TEXT NOT NULL,
  "operationId"    TEXT NOT NULL,
  "entity"         TEXT NOT NULL,
  "opType"         TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "result"         JSONB,
  "processedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_sync_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_sync_operations_organizationId_operationId_key"
  ON "mtm_sync_operations"("organizationId", "operationId");

CREATE INDEX "mtm_sync_operations_organizationId_agentId_idx"
  ON "mtm_sync_operations"("organizationId", "agentId");

-- Expire old sync ops after 30 days to avoid unbounded growth (optional, can be done via cron)
-- No FK to agentId because MtmAgent lives in a separate table and agents can be deactivated
ALTER TABLE "mtm_sync_operations"
  ADD CONSTRAINT "mtm_sync_operations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
