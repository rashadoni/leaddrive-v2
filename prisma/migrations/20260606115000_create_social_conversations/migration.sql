-- Fresh-install compatibility for the omnichannel conversation inbox. Later
-- migrations add snooze/folder/follow-up/AI-claim/tag fields.
CREATE TABLE IF NOT EXISTS "social_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelConfigId" TEXT,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT NOT NULL DEFAULT '',
    "contactAvatar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessage" TEXT NOT NULL DEFAULT '',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedTo" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "social_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "social_conversations_channelConfigId_fkey" FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_conversations_organizationId_platform_externalId_key"
    ON "social_conversations"("organizationId", "platform", "externalId");
CREATE INDEX IF NOT EXISTS "social_conversations_organizationId_idx" ON "social_conversations"("organizationId");
CREATE INDEX IF NOT EXISTS "social_conversations_organizationId_status_idx" ON "social_conversations"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "social_conversations_organizationId_lastMessageAt_idx" ON "social_conversations"("organizationId", "lastMessageAt");
