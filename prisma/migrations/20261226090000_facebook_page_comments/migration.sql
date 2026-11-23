-- Comments under a Facebook Page's posts, for Omni-Channel's «Комментарии» (owner, 2026-11-22/23).
-- A table of their own and not rows in channel_messages: a Page comment names its author by a user id
-- that is not the person's Messenger PSID, so it has no conversation to belong to, and every reader of
-- inbound Facebook rows (the AI's coverage, unread counters, the 24-hour window) would take it for a DM.
CREATE TABLE "facebook_page_comments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT,
  "pageId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "postId" TEXT,
  "parentId" TEXT,
  "fromId" TEXT,
  "fromName" TEXT,
  "body" TEXT NOT NULL,
  "commentedAt" TIMESTAMP(3) NOT NULL,
  "caption" TEXT,
  "permalink" TEXT,
  "imageUrl" TEXT,
  "isVideo" BOOLEAN NOT NULL DEFAULT false,
  "privateReplyAt" TIMESTAMP(3),
  "conversationId" TEXT,
  "replies" JSONB NOT NULL DEFAULT '[]',
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "facebook_page_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "facebook_page_comments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "facebook_page_comments_channelConfigId_fkey"
    FOREIGN KEY ("channelConfigId") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "facebook_page_comments_organizationId_commentId_key"
  ON "facebook_page_comments"("organizationId", "commentId");
CREATE INDEX "facebook_page_comments_organizationId_commentedAt_idx"
  ON "facebook_page_comments"("organizationId", "commentedAt");
CREATE INDEX "facebook_page_comments_organizationId_fromId_commentedAt_idx"
  ON "facebook_page_comments"("organizationId", "fromId", "commentedAt");
CREATE INDEX "facebook_page_comments_organizationId_postId_idx"
  ON "facebook_page_comments"("organizationId", "postId");

ALTER TABLE "facebook_page_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facebook_page_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "facebook_page_comments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
