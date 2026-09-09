-- Fresh-install compatibility: this table existed in deployed databases via
-- the historical schema bootstrap, but was never created by the migration
-- chain. The following Phase-4 migration adds agentConfigId/agentType, so this
-- idempotent migration must sort immediately before it.
--
-- CREATE TABLE IF NOT EXISTS is intentional: production databases that already
-- contain the table receive only a migration-history checkpoint and no data or
-- column rewrite.
CREATE TABLE IF NOT EXISTS "ai_interaction_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userMessage" TEXT NOT NULL,
    "aiResponse" TEXT NOT NULL,
    "latencyMs" DOUBLE PRECISION,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "model" TEXT,
    "toolsCalled" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "kbArticlesUsed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "qualityScore" DOUBLE PRECISION,
    "isCopilot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interaction_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_interaction_logs_organizationId_idx"
    ON "ai_interaction_logs"("organizationId");
