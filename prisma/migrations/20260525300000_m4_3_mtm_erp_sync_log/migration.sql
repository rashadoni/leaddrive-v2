-- M4-3: ERP SLA monitoring — sync run audit log
-- Creates mtm_erp_sync_logs to track every runLoggedSyncAll() invocation.
-- Written by sync-logger.ts; read by GET /api/v1/mtm/erp-health.

CREATE TABLE "mtm_erp_sync_logs" (
    "id"              TEXT        NOT NULL,
    "organizationId"  TEXT        NOT NULL,
    "startedAt"       TIMESTAMP(3) NOT NULL,
    "completedAt"     TIMESTAMP(3),
    "pricesResult"    JSONB,
    "customersResult" JSONB,
    "stockResult"     JSONB,
    "errorMessage"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mtm_erp_sync_logs_pkey" PRIMARY KEY ("id")
);

-- Descending index on startedAt so findFirst(orderBy: startedAt desc) is fast
CREATE INDEX "mtm_erp_sync_logs_organizationId_startedAt_idx"
    ON "mtm_erp_sync_logs"("organizationId", "startedAt" DESC);

ALTER TABLE "mtm_erp_sync_logs"
    ADD CONSTRAINT "mtm_erp_sync_logs_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
