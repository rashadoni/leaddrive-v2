-- «Черновики в Telegram» (lib/inbox/ai-draft-telegram): an AI reply draft is a card in the employees'
-- bot, kept as a telegram_staff_actions row of its own kind, with the statuses of a card's life.
ALTER TABLE "telegram_staff_actions" DROP CONSTRAINT IF EXISTS "telegram_staff_actions_kind_check";
ALTER TABLE "telegram_staff_actions" DROP CONSTRAINT IF EXISTS "telegram_staff_actions_status_check";
ALTER TABLE "telegram_staff_actions"
    ADD CONSTRAINT "telegram_staff_actions_kind_check" CHECK ("kind" IN ('create_lead', 'create_task', 'ai_draft')),
    ADD CONSTRAINT "telegram_staff_actions_status_check" CHECK ("status" IN ('pending', 'running', 'done', 'cancelled', 'expired', 'failed', 'awaiting_text', 'self', 'answered', 'closed', 'replaced'));

-- The open cards of one conversation are found by it (payload->>'conversationId').
CREATE INDEX IF NOT EXISTS "telegram_staff_actions_ai_draft_conversation_idx"
    ON "telegram_staff_actions" ("organizationId", ((payload ->> 'conversationId')))
    WHERE "kind" = 'ai_draft';
