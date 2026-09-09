-- CLM Slice 5a: contract_milestones — additive migration.
-- Distinct from PerformanceObligation (ASC-606 financial). Tracks
-- operational deliverables: owner, due date, status, reminder cron support.

CREATE TABLE "contract_milestones" (
    "id"             TEXT         NOT NULL,
    "organizationId" TEXT         NOT NULL,
    "contractId"     TEXT         NOT NULL,
    "label"          TEXT         NOT NULL,
    "description"    TEXT,
    "dueAt"          TIMESTAMP(3) NOT NULL,
    "completedAt"    TIMESTAMP(3),
    "status"         TEXT         NOT NULL DEFAULT 'pending',
    "ownerUserId"    TEXT,
    "lastRemindedAt" TIMESTAMP(3),
    "metadata"       JSONB        NOT NULL DEFAULT '{}',
    "createdBy"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_milestones_pkey" PRIMARY KEY ("id")
);

-- FK → contracts (Cascade delete — milestones die with their contract)
ALTER TABLE "contract_milestones"
    ADD CONSTRAINT "contract_milestones_contractId_fkey"
    FOREIGN KEY ("contractId")
    REFERENCES "contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite indexes for the two hot query paths:
--   1. List milestones for a given contract (org-scoped).
--   2. Cron: find pending/in_progress milestones due soon, ordered by dueAt.
CREATE INDEX "contract_milestones_organizationId_contractId_idx"
    ON "contract_milestones"("organizationId", "contractId");

CREATE INDEX "contract_milestones_organizationId_status_dueAt_idx"
    ON "contract_milestones"("organizationId", "status", "dueAt");
