-- An inbox AI agent of one page (an Instagram account, a Facebook page, a bot): its own
-- character and knowledge instead of the organisation's single common agent
-- (lib/inbox/page-agent). Such a row is agentType = 'inbox_page' and names its page here; every
-- existing row keeps NULL and behaves exactly as before.
--
-- Additive only: a nullable column nothing existing fills, and two indexes.
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "channelConfigId" TEXT;

CREATE INDEX IF NOT EXISTS "ai_agent_configs_organizationId_channelConfigId_idx"
  ON "ai_agent_configs" ("organizationId", "channelConfigId");

-- One agent per page. Two saves at once would otherwise create two rows and the engine would
-- pick between them at random. Partial, so it is invisible in schema.prisma on purpose — do not
-- "fix" the migrate-diff drift by dropping it.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_configs_page_agent_uniq"
  ON "ai_agent_configs" ("organizationId", "channelConfigId")
  WHERE "agentType" = 'inbox_page' AND "channelConfigId" IS NOT NULL;
