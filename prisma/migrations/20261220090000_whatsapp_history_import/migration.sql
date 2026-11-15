-- WhatsApp coexistence: the one-shot import of the WhatsApp Business app's contacts and its last
-- six months of chats (owner, 2026-11-15: «всё что у планифу есть должно быть у нас — это импорт и qr»).
-- See schema.prisma WhatsAppHistoryChunk / ChannelMessage.historyImportedAt and src/lib/whatsapp-history-import.

-- Marks an imported row. Nullable, no default: adding it rewrites nothing in a large table.
ALTER TABLE "channel_messages" ADD COLUMN "historyImportedAt" TIMESTAMP(3);

CREATE TABLE "whatsapp_history_chunks" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "phase" INTEGER,
  "chunkOrder" INTEGER,
  "progress" INTEGER,
  "errorCode" INTEGER,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "items" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB,
  "lastError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "whatsapp_history_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_history_chunks_kind_check" CHECK ("kind" IN ('contacts', 'history', 'media')),
  CONSTRAINT "whatsapp_history_chunks_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed')),
  CONSTRAINT "whatsapp_history_chunks_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_history_chunks_channelConfigId_fkey"
    FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "whatsapp_history_chunks_channelConfigId_fingerprint_key"
  ON "whatsapp_history_chunks"("channelConfigId", "fingerprint");
CREATE INDEX "whatsapp_history_chunks_organizationId_channelConfigId_status_idx"
  ON "whatsapp_history_chunks"("organizationId", "channelConfigId", "status");

ALTER TABLE "whatsapp_history_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_history_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_history_chunks"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
