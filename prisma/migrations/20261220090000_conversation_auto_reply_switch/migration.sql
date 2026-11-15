-- «AI rejimi» of one conversation (owner, 2026-11-15): when set, every automatic reply to this
-- customer stays silent — AI on every channel, WhatsApp Da Vinci, the booking bot, the keyword bot,
-- flow replies, the voice-note fallback and the backlog sweep. Null = the channel decides, as before.
-- Who switched it off is shown on the inbox tile. See src/lib/inbox/conversation-auto-reply.ts.
ALTER TABLE "social_conversations" ADD COLUMN "autoReplyOffAt" TIMESTAMP(3);
ALTER TABLE "social_conversations" ADD COLUMN "autoReplyOffBy" TEXT;
