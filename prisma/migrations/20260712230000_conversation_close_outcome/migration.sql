-- Close-with-outcome (Whelp-style disposition). Expand-only, nullable columns
-- on existing tables — no backfill, no NOT NULL, so this is safe to apply while
-- the app runs. Columns created on an EXISTING table inherit that table's
-- privileges for the application role, so no extra GRANT is required (unlike a
-- brand-new table created by the migration role).
ALTER TABLE "social_conversations"
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closeOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "closeOutcomeReason" TEXT;

ALTER TABLE "web_chat_sessions"
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closeOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "closeOutcomeReason" TEXT;

CREATE INDEX IF NOT EXISTS "social_conversations_organizationId_closeOutcome_idx"
  ON "social_conversations"("organizationId", "closeOutcome");
CREATE INDEX IF NOT EXISTS "web_chat_sessions_organizationId_closeOutcome_idx"
  ON "web_chat_sessions"("organizationId", "closeOutcome");
