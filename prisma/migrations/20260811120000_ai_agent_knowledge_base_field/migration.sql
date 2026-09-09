-- The inbox agent gains the second field the voice agent already has: rules in
-- systemPrompt, approved product facts here. Additive and nullable, so every
-- existing agent keeps behaving exactly as before until an administrator fills
-- it in, and no backfill runs under a migration that has no tenant context.
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "knowledgeBase" TEXT;
