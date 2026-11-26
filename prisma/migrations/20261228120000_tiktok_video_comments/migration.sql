-- Comments under owned TikTok videos, for Omni-Channel's «Комментарии» (owner, 2026-11-26: TikTok
-- froze new Business Messaging applications, so direct messages stay shut for us while comments —
-- `comment.list` and `comment.list.manage` — were approved on 2026-11-21 and work today).
-- A table of their own, like the Facebook one: the commenter is named by an id that is not a
-- messaging identity, the row has no conversation, and every reader of inbound TikTok rows would
-- take such a row for a direct message.
CREATE TABLE "tiktok_video_comments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "socialAccountId" TEXT,
  "businessId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "parentId" TEXT,
  "username" TEXT,
  "displayName" TEXT,
  "body" TEXT NOT NULL,
  "commentedAt" TIMESTAMP(3) NOT NULL,
  "caption" TEXT,
  "permalink" TEXT,
  "likes" INTEGER NOT NULL DEFAULT 0,
  "replies" JSONB NOT NULL DEFAULT '[]',
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tiktok_video_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tiktok_video_comments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tiktok_video_comments_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tiktok_video_comments_organizationId_commentId_key"
  ON "tiktok_video_comments"("organizationId", "commentId");
CREATE INDEX "tiktok_video_comments_organizationId_commentedAt_idx"
  ON "tiktok_video_comments"("organizationId", "commentedAt");
CREATE INDEX "tiktok_video_comments_organizationId_videoId_idx"
  ON "tiktok_video_comments"("organizationId", "videoId");

ALTER TABLE "tiktok_video_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tiktok_video_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tiktok_video_comments"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
