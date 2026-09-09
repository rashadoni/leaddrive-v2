-- Fresh-install compatibility: these provider fields existed in deployed
-- databases through the historical schema bootstrap but were absent from the
-- migration chain. ChannelConnection backfill reads settings and apiKey.
ALTER TABLE "channel_configs"
  ADD COLUMN IF NOT EXISTS "appId" TEXT,
  ADD COLUMN IF NOT EXISTS "appSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "pageId" TEXT,
  ADD COLUMN IF NOT EXISTS "settings" JSONB;
