CREATE TABLE IF NOT EXISTS "social_mention_ai_drafts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'needs_approval',
  "sentiment" TEXT,
  "language" TEXT NOT NULL DEFAULT 'az',
  "tone" TEXT NOT NULL DEFAULT 'official',
  "replyText" TEXT,
  "reasoning" TEXT,
  "regenerateReason" TEXT,
  "sourceDraftId" TEXT,
  "forbiddenReason" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "sendMode" TEXT NOT NULL DEFAULT 'dry_run',
  "sendResult" JSONB NOT NULL DEFAULT '{}',
  "reviewReason" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_mention_ai_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "social_mention_ai_drafts_org_mention_created_idx"
  ON "social_mention_ai_drafts" ("organizationId", "mentionId", "createdAt");

CREATE INDEX IF NOT EXISTS "social_mention_ai_drafts_org_status_created_idx"
  ON "social_mention_ai_drafts" ("organizationId", "status", "createdAt");

ALTER TABLE "social_mention_ai_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_mention_ai_drafts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "social_mention_ai_drafts";
CREATE POLICY tenant_isolation ON "social_mention_ai_drafts"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_mention_ai_drafts_organizationId_fkey'
  ) THEN
    ALTER TABLE "social_mention_ai_drafts"
      ADD CONSTRAINT "social_mention_ai_drafts_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_mention_ai_drafts_mentionId_fkey'
  ) THEN
    ALTER TABLE "social_mention_ai_drafts"
      ADD CONSTRAINT "social_mention_ai_drafts_mentionId_fkey"
      FOREIGN KEY ("mentionId") REFERENCES "social_mentions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
