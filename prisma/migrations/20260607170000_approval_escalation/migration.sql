-- Migration: Slice 3c — Approval Escalation
-- Additive: ADD COLUMN nullable/defaulted + CREATE TABLE
-- No data loss. Safe to apply to existing rows.

-- ─── ContractApprovalStage: SLA + escalation columns ────────────────────────

ALTER TABLE "contract_approval_stages"
    ADD COLUMN IF NOT EXISTS "slaHours"         INTEGER;

ALTER TABLE "contract_approval_stages"
    ADD COLUMN IF NOT EXISTS "dueAt"            TIMESTAMP(3);

ALTER TABLE "contract_approval_stages"
    ADD COLUMN IF NOT EXISTS "escalationLevel"  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "contract_approval_stages"
    ADD COLUMN IF NOT EXISTS "lastEscalatedAt"  TIMESTAMP(3);

-- Index for the cron query: find pending stages with overdue dueAt
CREATE INDEX IF NOT EXISTS "contract_approval_stages_organizationId_dueAt_status_idx"
    ON "contract_approval_stages"("organizationId", "dueAt", "status");

-- ─── ContractApprovalEscalationEvent (new table) ─────────────────────────────

CREATE TABLE IF NOT EXISTS "contract_approval_escalation_events" (
    "id"              TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "contractId"      TEXT NOT NULL,
    "stageId"         TEXT NOT NULL,
    "order"           INTEGER NOT NULL,
    "eventType"       TEXT NOT NULL DEFAULT 'escalated',
    "notifiedUserIds" JSONB NOT NULL,
    "level"           INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_approval_escalation_events_pkey" PRIMARY KEY ("id")
);

-- FK: → organizations
ALTER TABLE "contract_approval_escalation_events"
    ADD CONSTRAINT "contract_approval_escalation_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: → contracts
ALTER TABLE "contract_approval_escalation_events"
    ADD CONSTRAINT "contract_approval_escalation_events_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: → contract_approval_stages
ALTER TABLE "contract_approval_escalation_events"
    ADD CONSTRAINT "contract_approval_escalation_events_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "contract_approval_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for the listing query: by org + contract
CREATE INDEX IF NOT EXISTS "contract_approval_escalation_events_organizationId_contractId_idx"
    ON "contract_approval_escalation_events"("organizationId", "contractId");
