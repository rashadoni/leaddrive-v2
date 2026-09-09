-- Fresh-install compatibility for omnichannel message history. The following
-- migration adds the optional lead link; later migrations add partial inbound
-- idempotency indexes.
CREATE TABLE IF NOT EXISTS "channel_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelConfigId" TEXT,
    "direction" TEXT NOT NULL,
    "channelType" TEXT,
    "contactId" TEXT,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'delivered',
    "externalId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "conversationId" TEXT,
    "mediaUrl" TEXT,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "channel_messages_channelConfigId_fkey" FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "channel_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "social_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "channel_messages_organizationId_idx" ON "channel_messages"("organizationId");
CREATE INDEX IF NOT EXISTS "channel_messages_organizationId_contactId_idx" ON "channel_messages"("organizationId", "contactId");
CREATE INDEX IF NOT EXISTS "channel_messages_conversationId_idx" ON "channel_messages"("conversationId");
