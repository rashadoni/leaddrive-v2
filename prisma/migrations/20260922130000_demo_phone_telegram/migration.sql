-- A prospect can prove the phone on the demo request through Telegram instead
-- of an SMS code (owner, 2026-09-22: the SMS quota is limited). The prospect
-- opens a one-time t.me link to the sales organisation's own bot and shares
-- their own contact; Telegram vouches for the number. Nothing is sent to the
-- number itself, so nothing can reach a stranger.
--
-- Only the SHA-256 of the one-time link token is stored, looked up by value
-- when the bot receives "/start d_<token>". verifiedVia records which proof a
-- verification rests on.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "demo_phone_verifications"
  ADD COLUMN "telegramLinkHash" TEXT,
  ADD COLUMN "telegramLinkExpiresAt" TIMESTAMP(3),
  ADD COLUMN "telegramLinkIssueCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "telegramUserId" TEXT,
  ADD COLUMN "telegramProofMessage" TEXT,
  ADD COLUMN "verifiedVia" TEXT;

-- One Telegram message ("<chat id>:<message id>") proves one phone, once: a
-- replayed or redelivered update cannot verify a second demo with it.
CREATE UNIQUE INDEX "demo_phone_verifications_telegram_proof_key"
  ON "demo_phone_verifications"("telegramProofMessage");

CREATE UNIQUE INDEX "demo_phone_verifications_telegram_link_key"
  ON "demo_phone_verifications"("telegramLinkHash");

CREATE INDEX "demo_phone_verifications_telegram_user_idx"
  ON "demo_phone_verifications"("telegramUserId");

ALTER TABLE "demo_phone_verifications"
  ADD CONSTRAINT "demo_phone_verifications_verified_via_check"
  CHECK ("verifiedVia" IS NULL OR "verifiedVia" IN ('sms', 'telegram'));

COMMIT;
