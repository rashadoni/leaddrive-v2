-- AI auto-reply tight-loop guard (atomic). Replaces the prior read-then-write 8s cooldown
-- (findFirst → maybe send) with a conditional `updateMany WHERE aiReplyClaimedAt IS NULL
-- OR aiReplyClaimedAt < now-8s` claim. Postgres serializes the UPDATE, so two simultaneous
-- DUPLICATE inbound webhooks (one TikTok tap delivered as two messages) can never both win
-- → at most one AI reply. Additive nullable column — safe on a populated prod table.
ALTER TABLE "social_conversations" ADD COLUMN "aiReplyClaimedAt" TIMESTAMP(3);
