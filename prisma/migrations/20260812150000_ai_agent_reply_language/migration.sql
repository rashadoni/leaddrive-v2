-- The language the assistant answers in, per agent.
--
-- It used to be one rule for every tenant: default Azerbaijani, otherwise
-- mirror whatever the customer wrote. That is right for a tenant serving a
-- mixed audience and wrong for one whose brand answers in a single language --
-- and there was no way to say which you were.
--
-- NULL means "follow the customer", which is the behaviour every existing agent
-- has today, so this migration changes nothing until someone chooses.
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "replyLanguage" TEXT;
