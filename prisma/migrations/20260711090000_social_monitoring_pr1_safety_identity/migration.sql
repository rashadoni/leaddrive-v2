-- Social Monitoring V2 / PR1: canonical content identity, tenant-coherent
-- relations, immutable mention versions, and collector fencing leases.

SELECT set_config('app.rls_bypass', 'on', false);

ALTER TABLE "social_mentions"
  ADD COLUMN "contentKind" TEXT NOT NULL DEFAULT 'MENTION',
  ADD COLUMN "postExternalId" TEXT,
  ADD COLUMN "parentExternalId" TEXT,
  ADD COLUMN "threadExternalId" TEXT,
  ADD COLUMN "replyToExternalId" TEXT,
  ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "canonicalUrl" TEXT,
  ADD COLUMN "parentPostUrl" TEXT,
  ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAtSource" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Prisma manages @updatedAt in the client; the default is only needed while
-- backfilling existing rows during this migration.
ALTER TABLE "social_mentions"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

UPDATE "social_mentions"
SET
  "contentKind" = CASE lower("sourceType")
    WHEN 'post' THEN 'POST'
    WHEN 'comment' THEN 'COMMENT'
    WHEN 'reply' THEN 'REPLY'
    WHEN 'review' THEN 'REVIEW'
    WHEN 'dm' THEN 'DM'
    WHEN 'mention' THEN 'MENTION'
    ELSE 'UNKNOWN'
  END,
  "postExternalId" = COALESCE(
    "sourceMetadata"->>'postExternalId',
    "sourceMetadata"->>'postId',
    "sourceMetadata"->>'videoId'
  ),
  "parentExternalId" = COALESCE(
    "sourceMetadata"->>'parentExternalId',
    "sourceMetadata"->>'parentCommentId'
  ),
  "threadExternalId" = COALESCE(
    "sourceMetadata"->>'threadExternalId',
    "sourceMetadata"->>'threadId',
    "sourceMetadata"->>'conversationId'
  ),
  "replyToExternalId" = COALESCE(
    "sourceMetadata"->>'replyToExternalId',
    "sourceMetadata"->>'replyToCommentId'
  ),
  "depth" = CASE
    WHEN COALESCE("sourceMetadata"->>'depth', '') ~ '^[0-9]+$'
      THEN ("sourceMetadata"->>'depth')::INTEGER
    WHEN lower("sourceType") = 'reply' THEN 1
    ELSE 0
  END,
  "canonicalUrl" = CASE
    WHEN lower("sourceType") IN ('comment', 'reply')
      THEN COALESCE("sourceMetadata"->>'commentUrl', "sourceMetadata"->>'commentPermalink')
    ELSE "url"
  END,
  "parentPostUrl" = CASE
    WHEN lower("sourceType") IN ('comment', 'reply')
      THEN COALESCE(
        "sourceMetadata"->>'parentPostUrl',
        "sourceMetadata"->>'sourcePostUrl',
        "sourceMetadata"->>'postUrl',
        "sourceMetadata"->>'videoUrl',
        "url"
      )
    ELSE NULL
  END;

CREATE TABLE "social_mention_versions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "sourceMetadata" JSONB NOT NULL DEFAULT '{}',
  "publishedAt" TIMESTAMP(3),
  "editedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_mention_versions_pkey" PRIMARY KEY ("id")
);

INSERT INTO "social_mention_versions" (
  "id", "organizationId", "mentionId", "version", "text",
  "sourceMetadata", "publishedAt", "editedAt", "capturedAt"
)
SELECT
  'smv_' || md5("id" || ':1'),
  "organizationId",
  "id",
  1,
  "text",
  "sourceMetadata",
  "publishedAt",
  "editedAt",
  "createdAt"
FROM "social_mentions";

ALTER TABLE "monitoring_sources"
  ADD COLUMN "runClaimToken" TEXT,
  ADD COLUMN "runClaimExpiresAt" TIMESTAMP(3),
  ADD COLUMN "runClaimVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "collector_runs"
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "claimVersion" INTEGER,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

UPDATE "collector_runs"
SET
  "claimToken" = 'legacy:' || "id",
  "claimVersion" = 0,
  "leaseExpiresAt" = COALESCE("finishedAt", "startedAt" + INTERVAL '15 minutes');

ALTER TABLE "collector_runs"
  ALTER COLUMN "claimToken" SET NOT NULL,
  ALTER COLUMN "claimVersion" SET NOT NULL,
  ALTER COLUMN "leaseExpiresAt" SET NOT NULL;

-- Remove any legacy cross-tenant links before replacing single-column foreign
-- keys with tenant-coherent composite constraints. Invalid optional links are
-- detached; invalid owned child rows are deleted rather than reassigned.
UPDATE "social_mentions" AS child
SET "accountId" = NULL
WHERE child."accountId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "social_accounts" AS parent
    WHERE parent."id" = child."accountId"
      AND parent."organizationId" = child."organizationId"
  );

UPDATE "social_mentions" AS child
SET "clusterId" = NULL
WHERE child."clusterId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "mention_clusters" AS parent
    WHERE parent."id" = child."clusterId"
      AND parent."organizationId" = child."organizationId"
  );

UPDATE "mention_clusters" AS child
SET "primaryMentionId" = NULL
WHERE child."primaryMentionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "social_mentions" AS parent
    WHERE parent."id" = child."primaryMentionId"
      AND parent."organizationId" = child."organizationId"
  );

UPDATE "social_reply_channel_settings" AS child
SET "senderAccountId" = NULL
WHERE child."senderAccountId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "social_accounts" AS parent
    WHERE parent."id" = child."senderAccountId"
      AND parent."organizationId" = child."organizationId"
  );

UPDATE "mention_evidence" AS child
SET "sourceId" = NULL
WHERE child."sourceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "monitoring_sources" AS parent
    WHERE parent."id" = child."sourceId"
      AND parent."organizationId" = child."organizationId"
  );

UPDATE "social_legal_cases" AS child
SET "reportId" = NULL
WHERE child."reportId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "social_legal_reports" AS parent
    WHERE parent."id" = child."reportId"
      AND parent."organizationId" = child."organizationId"
  );

DELETE FROM "social_mention_ai_drafts" AS child
WHERE NOT EXISTS (
  SELECT 1 FROM "social_mentions" AS parent
  WHERE parent."id" = child."mentionId"
    AND parent."organizationId" = child."organizationId"
);

DELETE FROM "collector_runs" AS child
WHERE NOT EXISTS (
  SELECT 1 FROM "monitoring_sources" AS parent
  WHERE parent."id" = child."sourceId"
    AND parent."organizationId" = child."organizationId"
);

DELETE FROM "mention_evidence" AS child
WHERE NOT EXISTS (
  SELECT 1 FROM "social_mentions" AS parent
  WHERE parent."id" = child."mentionId"
    AND parent."organizationId" = child."organizationId"
);

DELETE FROM "social_legal_cases" AS child
WHERE NOT EXISTS (
  SELECT 1 FROM "social_mentions" AS parent
  WHERE parent."id" = child."mentionId"
    AND parent."organizationId" = child."organizationId"
);

CREATE UNIQUE INDEX "social_accounts_org_id_key"
  ON "social_accounts"("organizationId", "id");
CREATE UNIQUE INDEX "social_mentions_org_id_key"
  ON "social_mentions"("organizationId", "id");
CREATE UNIQUE INDEX "social_mention_ai_drafts_org_id_key"
  ON "social_mention_ai_drafts"("organizationId", "id");
CREATE UNIQUE INDEX "monitoring_sources_org_id_key"
  ON "monitoring_sources"("organizationId", "id");
CREATE UNIQUE INDEX "mention_clusters_org_id_key"
  ON "mention_clusters"("organizationId", "id");
CREATE UNIQUE INDEX "social_legal_cases_org_id_key"
  ON "social_legal_cases"("organizationId", "id");
CREATE UNIQUE INDEX "social_legal_reports_org_id_key"
  ON "social_legal_reports"("organizationId", "id");

CREATE UNIQUE INDEX "social_mention_versions_org_mention_version_key"
  ON "social_mention_versions"("organizationId", "mentionId", "version");
CREATE INDEX "social_mention_versions_org_mention_captured_idx"
  ON "social_mention_versions"("organizationId", "mentionId", "capturedAt");
CREATE INDEX "social_mentions_org_platform_post_external_idx"
  ON "social_mentions"("organizationId", "platform", "postExternalId");
CREATE INDEX "social_mentions_org_platform_canonical_url_idx"
  ON "social_mentions"("organizationId", "platform", "canonicalUrl");
CREATE INDEX "social_mentions_org_platform_thread_published_idx"
  ON "social_mentions"("organizationId", "platform", "threadExternalId", "publishedAt");
CREATE INDEX "monitoring_sources_org_claim_expiry_idx"
  ON "monitoring_sources"("organizationId", "runClaimExpiresAt");
CREATE INDEX "collector_runs_org_claim_idx"
  ON "collector_runs"("organizationId", "sourceId", "claimVersion");

ALTER TABLE "social_mentions" DROP CONSTRAINT IF EXISTS "social_mentions_accountId_fkey";
ALTER TABLE "social_mentions" DROP CONSTRAINT IF EXISTS "social_mentions_clusterId_fkey";
ALTER TABLE "social_mention_ai_drafts" DROP CONSTRAINT IF EXISTS "social_mention_ai_drafts_mentionId_fkey";
ALTER TABLE "social_reply_channel_settings" DROP CONSTRAINT IF EXISTS "social_reply_channel_settings_senderAccountId_fkey";
ALTER TABLE "collector_runs" DROP CONSTRAINT IF EXISTS "collector_runs_sourceId_fkey";
ALTER TABLE "mention_evidence" DROP CONSTRAINT IF EXISTS "mention_evidence_mentionId_fkey";
ALTER TABLE "mention_evidence" DROP CONSTRAINT IF EXISTS "mention_evidence_sourceId_fkey";
ALTER TABLE "mention_clusters" DROP CONSTRAINT IF EXISTS "mention_clusters_primaryMentionId_fkey";
ALTER TABLE "social_legal_cases" DROP CONSTRAINT IF EXISTS "social_legal_cases_mentionId_fkey";
ALTER TABLE "social_legal_cases" DROP CONSTRAINT IF EXISTS "social_legal_cases_reportId_fkey";

ALTER TABLE "social_mentions"
  ADD CONSTRAINT "social_mentions_organizationId_accountId_fkey"
  FOREIGN KEY ("organizationId", "accountId")
  REFERENCES "social_accounts"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "social_mentions"
  ADD CONSTRAINT "social_mentions_organizationId_clusterId_fkey"
  FOREIGN KEY ("organizationId", "clusterId")
  REFERENCES "mention_clusters"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "social_mention_ai_drafts"
  ADD CONSTRAINT "social_mention_ai_drafts_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_reply_channel_settings"
  ADD CONSTRAINT "social_reply_channel_settings_organizationId_senderAccount_fkey"
  FOREIGN KEY ("organizationId", "senderAccountId")
  REFERENCES "social_accounts"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "collector_runs"
  ADD CONSTRAINT "collector_runs_organizationId_sourceId_fkey"
  FOREIGN KEY ("organizationId", "sourceId")
  REFERENCES "monitoring_sources"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mention_evidence"
  ADD CONSTRAINT "mention_evidence_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mention_evidence"
  ADD CONSTRAINT "mention_evidence_organizationId_sourceId_fkey"
  FOREIGN KEY ("organizationId", "sourceId")
  REFERENCES "monitoring_sources"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "mention_clusters"
  ADD CONSTRAINT "mention_clusters_organizationId_primaryMentionId_fkey"
  FOREIGN KEY ("organizationId", "primaryMentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "social_legal_cases"
  ADD CONSTRAINT "social_legal_cases_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_legal_cases"
  ADD CONSTRAINT "social_legal_cases_organizationId_reportId_fkey"
  FOREIGN KEY ("organizationId", "reportId")
  REFERENCES "social_legal_reports"("organizationId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "social_mention_versions"
  ADD CONSTRAINT "social_mention_versions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_mention_versions"
  ADD CONSTRAINT "social_mention_versions_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_mention_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_mention_versions" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "social_mention_versions"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

SELECT set_config('app.rls_bypass', 'off', false);
