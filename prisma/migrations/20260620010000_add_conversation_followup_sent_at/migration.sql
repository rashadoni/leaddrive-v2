-- 24h-silence auto-follow-up: atomic idempotency marker for the TikTok nudge.
-- Stamped (via a conditional `updateMany WHERE followUpSentAt IS NULL`) when the nudge
-- is sent, so two overlapping cron ticks can never double-send. Additive nullable column
-- (null = not yet nudged) — existing rows default to NULL, no data rewrite.
ALTER TABLE "social_conversations" ADD COLUMN "followUpSentAt" TIMESTAMP(3);

-- Partial index to keep the candidate scan cheap: only un-nudged threads matter.
CREATE INDEX "social_conversations_org_followup_idx"
  ON "social_conversations" ("organizationId", "lastMessageAt")
  WHERE "followUpSentAt" IS NULL;
