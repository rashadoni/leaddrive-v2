-- Social Signal Monitoring foundation.
-- Adds monitored source inventory, collector run history, evidence records,
-- duplicate/viral clustering, and fail-closed reply policies.

ALTER TABLE "social_mentions"
  ADD COLUMN IF NOT EXISTS "clusterId" TEXT;

CREATE TABLE IF NOT EXISTS "monitoring_sources" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "url" TEXT,
  "handle" TEXT,
  "query" TEXT,
  "ownership" TEXT NOT NULL DEFAULT 'unknown',
  "collectionMode" TEXT NOT NULL,
  "cadenceMinutes" INTEGER NOT NULL DEFAULT 60,
  "keywords" TEXT[] NOT NULL DEFAULT '{}',
  "riskLevel" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastCheckedAt" TIMESTAMP(3),
  "lastSuccessfulAt" TIMESTAMP(3),
  "lastError" TEXT,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitoring_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "collector_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'running',
  "foundCount" INTEGER NOT NULL DEFAULT 0,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "ignoredCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "rawStats" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "collector_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mention_clusters" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clusterKey" TEXT NOT NULL,
  "primaryMentionId" TEXT,
  "topic" TEXT,
  "sentiment" TEXT,
  "riskLevel" TEXT NOT NULL DEFAULT 'medium',
  "mentionCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mention_clusters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mention_evidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "sourceId" TEXT,
  "permalink" TEXT,
  "screenshotUrl" TEXT,
  "rawSnippet" TEXT,
  "rawPayload" JSONB NOT NULL DEFAULT '{}',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sourceTrustTier" TEXT NOT NULL DEFAULT 'T6',
  CONSTRAINT "mention_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "reply_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "collectionMode" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "allowAiDraft" BOOLEAN NOT NULL DEFAULT true,
  "allowAutoReply" BOOLEAN NOT NULL DEFAULT false,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
  "liveSendAllowed" BOOLEAN NOT NULL DEFAULT false,
  "blockedReasons" TEXT[] NOT NULL DEFAULT '{}',
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reply_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "monitoring_sources_org_mode_url_key"
  ON "monitoring_sources" ("organizationId", "platform", "sourceType", "collectionMode", "url");

CREATE UNIQUE INDEX IF NOT EXISTS "monitoring_sources_org_mode_query_key"
  ON "monitoring_sources" ("organizationId", "platform", "sourceType", "collectionMode", "query");

CREATE INDEX IF NOT EXISTS "monitoring_sources_org_status_checked_idx"
  ON "monitoring_sources" ("organizationId", "status", "lastCheckedAt");

CREATE INDEX IF NOT EXISTS "monitoring_sources_org_platform_type_idx"
  ON "monitoring_sources" ("organizationId", "platform", "sourceType");

CREATE INDEX IF NOT EXISTS "monitoring_sources_org_mode_status_idx"
  ON "monitoring_sources" ("organizationId", "collectionMode", "status");

CREATE INDEX IF NOT EXISTS "monitoring_sources_org_risk_idx"
  ON "monitoring_sources" ("organizationId", "riskLevel");

CREATE INDEX IF NOT EXISTS "collector_runs_org_source_started_idx"
  ON "collector_runs" ("organizationId", "sourceId", "startedAt");

CREATE INDEX IF NOT EXISTS "collector_runs_org_status_started_idx"
  ON "collector_runs" ("organizationId", "status", "startedAt");

CREATE INDEX IF NOT EXISTS "collector_runs_source_started_idx"
  ON "collector_runs" ("sourceId", "startedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "mention_clusters_org_cluster_key"
  ON "mention_clusters" ("organizationId", "clusterKey");

CREATE INDEX IF NOT EXISTS "mention_clusters_org_risk_last_seen_idx"
  ON "mention_clusters" ("organizationId", "riskLevel", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "mention_clusters_org_sentiment_last_seen_idx"
  ON "mention_clusters" ("organizationId", "sentiment", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "social_mentions_org_cluster_idx"
  ON "social_mentions" ("organizationId", "clusterId");

CREATE INDEX IF NOT EXISTS "mention_evidence_org_mention_captured_idx"
  ON "mention_evidence" ("organizationId", "mentionId", "capturedAt");

CREATE INDEX IF NOT EXISTS "mention_evidence_org_source_captured_idx"
  ON "mention_evidence" ("organizationId", "sourceId", "capturedAt");

CREATE INDEX IF NOT EXISTS "mention_evidence_org_trust_tier_idx"
  ON "mention_evidence" ("organizationId", "sourceTrustTier");

CREATE UNIQUE INDEX IF NOT EXISTS "reply_policies_org_platform_mode_type_key"
  ON "reply_policies" ("organizationId", "platform", "collectionMode", "sourceType");

CREATE INDEX IF NOT EXISTS "reply_policies_org_platform_idx"
  ON "reply_policies" ("organizationId", "platform");

CREATE INDEX IF NOT EXISTS "reply_policies_org_mode_type_idx"
  ON "reply_policies" ("organizationId", "collectionMode", "sourceType");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'monitoring_sources_organizationId_fkey'
  ) THEN
    ALTER TABLE "monitoring_sources"
      ADD CONSTRAINT "monitoring_sources_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collector_runs_organizationId_fkey'
  ) THEN
    ALTER TABLE "collector_runs"
      ADD CONSTRAINT "collector_runs_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collector_runs_sourceId_fkey'
  ) THEN
    ALTER TABLE "collector_runs"
      ADD CONSTRAINT "collector_runs_sourceId_fkey"
      FOREIGN KEY ("sourceId") REFERENCES "monitoring_sources"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mention_clusters_organizationId_fkey'
  ) THEN
    ALTER TABLE "mention_clusters"
      ADD CONSTRAINT "mention_clusters_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mention_clusters_primaryMentionId_fkey'
  ) THEN
    ALTER TABLE "mention_clusters"
      ADD CONSTRAINT "mention_clusters_primaryMentionId_fkey"
      FOREIGN KEY ("primaryMentionId") REFERENCES "social_mentions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_mentions_clusterId_fkey'
  ) THEN
    ALTER TABLE "social_mentions"
      ADD CONSTRAINT "social_mentions_clusterId_fkey"
      FOREIGN KEY ("clusterId") REFERENCES "mention_clusters"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mention_evidence_organizationId_fkey'
  ) THEN
    ALTER TABLE "mention_evidence"
      ADD CONSTRAINT "mention_evidence_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mention_evidence_mentionId_fkey'
  ) THEN
    ALTER TABLE "mention_evidence"
      ADD CONSTRAINT "mention_evidence_mentionId_fkey"
      FOREIGN KEY ("mentionId") REFERENCES "social_mentions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mention_evidence_sourceId_fkey'
  ) THEN
    ALTER TABLE "mention_evidence"
      ADD CONSTRAINT "mention_evidence_sourceId_fkey"
      FOREIGN KEY ("sourceId") REFERENCES "monitoring_sources"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reply_policies_organizationId_fkey'
  ) THEN
    ALTER TABLE "reply_policies"
      ADD CONSTRAINT "reply_policies_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "monitoring_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monitoring_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "collector_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collector_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mention_clusters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mention_clusters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mention_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mention_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reply_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reply_policies" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "monitoring_sources";
CREATE POLICY tenant_isolation ON "monitoring_sources"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON "collector_runs";
CREATE POLICY tenant_isolation ON "collector_runs"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON "mention_clusters";
CREATE POLICY tenant_isolation ON "mention_clusters"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON "mention_evidence";
CREATE POLICY tenant_isolation ON "mention_evidence"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );

DROP POLICY IF EXISTS tenant_isolation ON "reply_policies";
CREATE POLICY tenant_isolation ON "reply_policies"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
