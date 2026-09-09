ALTER TABLE "social_conversations"
  ADD COLUMN "aiReplyClaimToken" TEXT,
  ADD COLUMN "aiReplyClaimedUntil" TIMESTAMP(3);
