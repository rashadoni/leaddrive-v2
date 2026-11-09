-- Which advertisement brought the conversation (Meta Click-to-WhatsApp `referral`).
-- Nullable and first-touch: existing rows keep meaning exactly what they meant.
ALTER TABLE "social_conversations" ADD COLUMN "adSourceType" TEXT;
ALTER TABLE "social_conversations" ADD COLUMN "adSourceId" TEXT;
ALTER TABLE "social_conversations" ADD COLUMN "adHeadline" TEXT;
ALTER TABLE "social_conversations" ADD COLUMN "adReferralAt" TIMESTAMP(3);

-- The report asks «which ads brought chats in this period», so it reads the
-- stamp first and groups by the ad second.
CREATE INDEX "social_conversations_organizationId_adReferralAt_idx" ON "social_conversations"("organizationId", "adReferralAt");
