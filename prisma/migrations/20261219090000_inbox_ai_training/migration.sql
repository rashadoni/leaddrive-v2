-- Inbox AI training (owner, 2026-11-15: «режим обучения … изучал, как переписывается клиент,
-- на основе этого заполнял характер и базу знаний ИИ»); see schema.prisma InboxLearnedItem /
-- InboxLearningSample and src/lib/inbox/learning. Tenant tables under FORCE ROW LEVEL SECURITY.
CREATE TABLE "inbox_learned_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "alternatives" JSONB,
  "source" TEXT NOT NULL DEFAULT 'learned',
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceConversationId" TEXT,
  "sourceMessageId" TEXT,
  "editedById" TEXT,
  "editedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inbox_learned_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inbox_learned_items_kind_check" CHECK ("kind" IN ('knowledge', 'trait')),
  CONSTRAINT "inbox_learned_items_status_check" CHECK ("status" IN ('active', 'pending', 'conflict')),
  CONSTRAINT "inbox_learned_items_source_check" CHECK ("source" IN ('learned', 'manual')),
  CONSTRAINT "inbox_learned_items_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inbox_learned_items_channelConfigId_fkey"
    FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "inbox_learned_items_organizationId_channelConfigId_kind_idx"
  ON "inbox_learned_items"("organizationId", "channelConfigId", "kind");

CREATE TABLE "inbox_learning_samples" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "answerMessageId" TEXT NOT NULL,
  "questionMessageId" TEXT,
  "verdict" TEXT NOT NULL,
  "topic" TEXT,
  "reason" TEXT,
  "draftLogId" TEXT,
  "resolution" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "extractedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_learning_samples_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inbox_learning_samples_verdict_check"
    CHECK ("verdict" IN ('same', 'almost', 'different', 'handoff', 'skipped', 'no_question', 'failed')),
  CONSTRAINT "inbox_learning_samples_resolution_check" CHECK ("resolution" IS NULL OR "resolution" IN ('accepted', 'taught')),
  CONSTRAINT "inbox_learning_samples_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inbox_learning_samples_channelConfigId_fkey"
    FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inbox_learning_samples_answerMessageId_key" ON "inbox_learning_samples"("answerMessageId");
CREATE INDEX "inbox_learning_samples_organizationId_channelConfigId_createdAt_idx"
  ON "inbox_learning_samples"("organizationId", "channelConfigId", "createdAt");
CREATE INDEX "inbox_learning_samples_organizationId_conversationId_idx"
  ON "inbox_learning_samples"("organizationId", "conversationId");

ALTER TABLE "inbox_learned_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_learned_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inbox_learned_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "inbox_learning_samples" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_learning_samples" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inbox_learning_samples"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
