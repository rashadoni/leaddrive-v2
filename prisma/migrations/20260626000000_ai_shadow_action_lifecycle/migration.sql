ALTER TABLE "ai_shadow_actions"
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS "sourceSignalId" TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "editedPayload" JSONB,
  ADD COLUMN IF NOT EXISTS "executionStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "executedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT;

UPDATE "ai_shadow_actions"
SET "executionStatus" = CASE
  WHEN approved IS TRUE THEN 'approved'
  WHEN approved IS FALSE THEN 'rejected'
  ELSE 'pending'
END
WHERE "executionStatus" = 'pending';

CREATE INDEX IF NOT EXISTS "ai_shadow_actions_organizationId_executionStatus_idx"
  ON "ai_shadow_actions" ("organizationId", "executionStatus");
