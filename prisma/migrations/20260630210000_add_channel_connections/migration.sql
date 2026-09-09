-- Canonical multi-surface channel model.
-- Existing ChannelConfig rows stay intact; ChannelConnection becomes the
-- platform/surface/provider routing layer used by TikTok Hub and future channels.

CREATE TABLE "channel_connections" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT,
  "platform" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'needs_access',
  "capabilities" JSONB NOT NULL DEFAULT '{}',
  "settings" JSONB NOT NULL DEFAULT '{}',
  "secretRef" TEXT,
  "apiKey" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "lastHealthCheckAt" TIMESTAMP(3),
  "lastInboundAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_connections_org_platform_surface_provider_key"
  ON "channel_connections"("organizationId", "platform", "surface", "provider");

CREATE INDEX "channel_connections_org_platform_idx"
  ON "channel_connections"("organizationId", "platform");

CREATE INDEX "channel_connections_org_platform_surface_idx"
  ON "channel_connections"("organizationId", "platform", "surface");

CREATE INDEX "channel_connections_org_status_idx"
  ON "channel_connections"("organizationId", "status");

CREATE INDEX "channel_connections_channel_config_idx"
  ON "channel_connections"("channelConfigId");

ALTER TABLE "channel_connections"
  ADD CONSTRAINT "channel_connections_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "channel_connections"
  ADD CONSTRAINT "channel_connections_channel_config_fkey"
  FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "channel_connections" (
  "id",
  "organizationId",
  "channelConfigId",
  "platform",
  "surface",
  "provider",
  "displayName",
  "status",
  "capabilities",
  "settings",
  "lastInboundAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'cc_' || md5("id" || ':tiktok:dm:chatwoot'),
  "organizationId",
  "id",
  'tiktok',
  'dm',
  'chatwoot',
  COALESCE(NULLIF("configName", ''), 'TikTok DM via Chatwoot'),
  CASE WHEN "isActive" THEN 'connected' ELSE 'disabled' END,
  '{"read":true,"reply":true,"webhook":true,"importLead":false}'::jsonb,
  jsonb_strip_nulls(
    jsonb_build_object(
      'legacyChannelConfigId', "id",
      'baseUrl', "settings"->>'baseUrl',
      'accountId', "settings"->'accountId',
      'inboxId', "settings"->'inboxId',
      'webhookSecretConfigured', ("settings"->>'webhookSecret') IS NOT NULL,
      'apiKeyConfigured', "apiKey" IS NOT NULL
    )
  ),
  (
    SELECT MAX(cm."createdAt")
    FROM "channel_messages" cm
    WHERE cm."organizationId" = cc."organizationId"
      AND cm."channelType" = 'tiktok'
      AND cm."direction" = 'inbound'
      AND cm."channelConfigId" = cc."id"
  ),
  "createdAt",
  "updatedAt"
FROM "channel_configs" cc
WHERE "channelType" = 'chatwoot'
  AND (
    "settings"->>'provider' = 'tiktok'
    OR "settings"->>'platform' = 'tiktok'
    OR "configName" ILIKE '%tiktok%'
  )
ON CONFLICT ("organizationId", "platform", "surface", "provider") DO NOTHING;
