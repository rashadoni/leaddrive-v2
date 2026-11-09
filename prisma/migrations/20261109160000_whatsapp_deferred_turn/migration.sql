-- One automatic answer per waiting message, on a number the team answers from their phone.
--
-- On a coexistence channel our agents stay silent inside the webhook so a person with the phone
-- answers first (lib/inbox/whatsapp-reply-hold). A minute later somebody has to decide whether the
-- customer is still waiting — and that decision must be taken exactly once per message, by exactly
-- one worker, whatever happens afterwards.
--
-- A timestamp column, not a JSON flag: claiming it is a single conditional UPDATE
-- (`WHERE "deferredTurnAt" IS NULL`), so two overlapping runs cannot both take the same message,
-- and a crash between claiming and sending costs one unanswered message instead of a loop that
-- re-asks the model every minute. The same precedent as `social_conversations."followUpSentAt"`.
ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "deferredTurnAt" TIMESTAMP(3);

-- The worker asks one question: which inbound rows of these channels are still unclaimed? Partial,
-- because every row that has been dealt with is of no further interest and the table is large.
CREATE INDEX IF NOT EXISTS "channel_messages_deferred_turn_pending_idx"
  ON "channel_messages" ("channelConfigId", "createdAt")
  WHERE "direction" = 'inbound' AND "channelType" = 'whatsapp' AND "deferredTurnAt" IS NULL;
