-- Fresh-install compatibility: ai_alerts existed in deployed schemas before
-- its index-only migration entered the chain.
CREATE TABLE IF NOT EXISTS "ai_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "sessionId" TEXT,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_alerts_organizationId_idx"
    ON "ai_alerts"("organizationId");
