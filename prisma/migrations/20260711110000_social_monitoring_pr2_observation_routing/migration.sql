-- CreateTable
SELECT set_config('app.rls_bypass', 'on', false);

CREATE TABLE "social_provider_capability_proofs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proofKey" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "contentScopeKey" TEXT NOT NULL,
    "contentScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contractVersion" TEXT,
    "policyVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "endpointHost" TEXT,
    "readAllowed" BOOLEAN NOT NULL DEFAULT false,
    "replyAllowed" BOOLEAN NOT NULL DEFAULT false,
    "aiProcessingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "exportAllowed" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "sandboxVerifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_provider_capability_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_route_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "platform" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "contentScope" TEXT NOT NULL,
    "primaryAdapter" TEXT NOT NULL,
    "fallbackAdapters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capabilityProofId" TEXT,
    "connectionAccountId" TEXT,
    "acquisitionMode" TEXT NOT NULL,
    "replyMode" TEXT NOT NULL DEFAULT 'NO_ACTION',
    "executionOrder" INTEGER NOT NULL DEFAULT 0,
    "dependsOnCapability" TEXT,
    "budget" JSONB NOT NULL DEFAULT '{}',
    "rateLimit" JSONB NOT NULL DEFAULT '{}',
    "freshnessMinutes" INTEGER NOT NULL DEFAULT 60,
    "failoverConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policyVersion" TEXT NOT NULL,
    "contractVersion" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "circuitOpenUntil" TIMESTAMP(3),
    "lastFailureClass" TEXT,
    "lastSucceededAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "compiledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_route_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_provider_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "routePlanId" TEXT NOT NULL,
    "collectorRunId" TEXT,
    "parentRunId" TEXT,
    "providerKey" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "externalRunId" TEXT,
    "actorId" TEXT,
    "actorBuild" TEXT,
    "datasetId" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL DEFAULT '{}',
    "webhookSecretHash" TEXT,
    "reservedChargeUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "actualChargeUsd" DECIMAL(12,6),
    "maxTotalChargeUsd" DECIMAL(12,6) NOT NULL,
    "dailyBudgetUsd" DECIMAL(12,6),
    "monthlyBudgetUsd" DECIMAL(12,6),
    "maxItems" INTEGER NOT NULL,
    "timeoutSeconds" INTEGER NOT NULL,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_provider_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_envelopes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT,
    "collectorRunId" TEXT,
    "routePlanId" TEXT,
    "providerRunId" TEXT,
    "acceptedMentionId" TEXT,
    "adapterKey" TEXT NOT NULL,
    "providerKey" TEXT,
    "providerItemId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "acquisitionMode" TEXT NOT NULL,
    "contentKind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT,
    "externalIds" JSONB NOT NULL DEFAULT '{}',
    "postExternalId" TEXT,
    "parentExternalId" TEXT,
    "threadExternalId" TEXT,
    "replyToExternalId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,
    "canonicalUrl" TEXT,
    "parentPostUrl" TEXT,
    "authorName" TEXT,
    "authorHandle" TEXT,
    "authorAvatar" TEXT,
    "text" TEXT,
    "contentHmac" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "policySnapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "deletedAtSource" TIMESTAMP(3),
    "relevanceStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "relevanceReason" TEXT,
    "relevanceConfidence" DOUBLE PRECISION,
    "matchedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "normalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3) NOT NULL,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingest_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_observation_fingerprints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT,
    "adapterKey" TEXT NOT NULL,
    "providerKey" TEXT,
    "fingerprintHmac" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "duplicateCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rejected_observation_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_deletion_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKeyHmac" TEXT NOT NULL,
    "storageScope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "nextRetryAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_deletion_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_connection_cursors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "cursorKey" TEXT NOT NULL,
    "cursorValue" TEXT NOT NULL,
    "cursorVersion" INTEGER NOT NULL DEFAULT 1,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connection_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_provider_proofs_lookup_idx" ON "social_provider_capability_proofs"("organizationId", "providerKey", "platform", "capability", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_provider_capability_proofs_org_id_key" ON "social_provider_capability_proofs"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "social_provider_capability_proofs_org_proof_key" ON "social_provider_capability_proofs"("organizationId", "proofKey");

-- CreateIndex
CREATE INDEX "source_route_plans_source_exec_idx" ON "source_route_plans"("organizationId", "sourceId", "status", "executionOrder");

-- CreateIndex
CREATE INDEX "source_route_plans_scenario_capability_idx" ON "source_route_plans"("organizationId", "scenarioId", "platform", "capability");

-- CreateIndex
CREATE INDEX "source_route_plans_circuit_idx" ON "source_route_plans"("organizationId", "circuitOpenUntil");

-- CreateIndex
CREATE UNIQUE INDEX "source_route_plans_org_id_key" ON "source_route_plans"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "source_route_plans_org_route_key" ON "source_route_plans"("organizationId", "routeKey");

-- CreateIndex
CREATE INDEX "social_provider_runs_status_idx" ON "social_provider_runs"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "social_provider_runs_source_idx" ON "social_provider_runs"("organizationId", "sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "social_provider_runs_purge_idx" ON "social_provider_runs"("organizationId", "purgeAt", "purgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_provider_runs_org_id_key" ON "social_provider_runs"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "social_provider_runs_org_idempotency_key" ON "social_provider_runs"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "social_provider_runs_org_external_key" ON "social_provider_runs"("organizationId", "providerKey", "externalRunId");

-- CreateIndex
CREATE INDEX "ingest_envelopes_relevance_idx" ON "ingest_envelopes"("organizationId", "relevanceStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ingest_envelopes_purge_idx" ON "ingest_envelopes"("organizationId", "purgeAt", "purgedAt");

-- CreateIndex
CREATE INDEX "ingest_envelopes_source_provider_item_idx" ON "ingest_envelopes"("organizationId", "sourceId", "providerItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_envelopes_org_id_key" ON "ingest_envelopes"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_envelopes_org_idempotency_key" ON "ingest_envelopes"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "rejected_observation_fingerprints_expiry_idx" ON "rejected_observation_fingerprints"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "rejected_observation_fingerprints_org_adapter_hmac_key" ON "rejected_observation_fingerprints"("organizationId", "adapterKey", "fingerprintHmac");

-- CreateIndex
CREATE INDEX "social_deletion_ledger_due_idx" ON "social_deletion_ledger_entries"("organizationId", "status", "dueAt", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_deletion_ledger_org_idempotency_key" ON "social_deletion_ledger_entries"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "social_connection_cursors_adapter_idx" ON "social_connection_cursors"("organizationId", "adapterKey", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_connection_cursors_org_account_adapter_key" ON "social_connection_cursors"("organizationId", "accountId", "adapterKey", "cursorKey");

-- CreateIndex
CREATE UNIQUE INDEX "collector_runs_org_id_key" ON "collector_runs"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "social_provider_capability_proofs" ADD CONSTRAINT "social_provider_capability_proofs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_route_plans" ADD CONSTRAINT "source_route_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_route_plans" ADD CONSTRAINT "source_route_plans_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_route_plans" ADD CONSTRAINT "source_route_plans_organizationId_capabilityProofId_fkey" FOREIGN KEY ("organizationId", "capabilityProofId") REFERENCES "social_provider_capability_proofs"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_route_plans" ADD CONSTRAINT "source_route_plans_organizationId_connectionAccountId_fkey" FOREIGN KEY ("organizationId", "connectionAccountId") REFERENCES "social_accounts"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_provider_runs" ADD CONSTRAINT "social_provider_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_provider_runs" ADD CONSTRAINT "social_provider_runs_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_provider_runs" ADD CONSTRAINT "social_provider_runs_organizationId_routePlanId_fkey" FOREIGN KEY ("organizationId", "routePlanId") REFERENCES "source_route_plans"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_provider_runs" ADD CONSTRAINT "social_provider_runs_organizationId_collectorRunId_fkey" FOREIGN KEY ("organizationId", "collectorRunId") REFERENCES "collector_runs"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_provider_runs" ADD CONSTRAINT "social_provider_runs_organizationId_parentRunId_fkey" FOREIGN KEY ("organizationId", "parentRunId") REFERENCES "social_provider_runs"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_envelopes" ADD CONSTRAINT "ingest_envelopes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_envelopes" ADD CONSTRAINT "ingest_envelopes_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_envelopes" ADD CONSTRAINT "ingest_envelopes_organizationId_collectorRunId_fkey" FOREIGN KEY ("organizationId", "collectorRunId") REFERENCES "collector_runs"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_envelopes" ADD CONSTRAINT "ingest_envelopes_organizationId_routePlanId_fkey" FOREIGN KEY ("organizationId", "routePlanId") REFERENCES "source_route_plans"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_envelopes" ADD CONSTRAINT "ingest_envelopes_organizationId_providerRunId_fkey" FOREIGN KEY ("organizationId", "providerRunId") REFERENCES "social_provider_runs"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_envelopes" ADD CONSTRAINT "ingest_envelopes_organizationId_acceptedMentionId_fkey" FOREIGN KEY ("organizationId", "acceptedMentionId") REFERENCES "social_mentions"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_observation_fingerprints" ADD CONSTRAINT "rejected_observation_fingerprints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_observation_fingerprints" ADD CONSTRAINT "rejected_observation_fingerprints_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_deletion_ledger_entries" ADD CONSTRAINT "social_deletion_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connection_cursors" ADD CONSTRAINT "social_connection_cursors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connection_cursors" ADD CONSTRAINT "social_connection_cursors_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "social_accounts"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Precompile one deterministic entry route for every existing source. Runtime
-- collection fails closed when this stored route is absent or blocked; it does
-- not ask an LLM (or dynamically pick an arbitrary scraper) on each run.
INSERT INTO "source_route_plans" (
    "id", "organizationId", "routeKey", "sourceId", "scenarioId",
    "platform", "capability", "contentScope", "primaryAdapter",
    "fallbackAdapters", "connectionAccountId", "acquisitionMode",
    "replyMode", "executionOrder", "budget", "rateLimit",
    "freshnessMinutes", "failoverConditions", "policyVersion", "reason",
    "status", "compiledAt", "createdAt", "updatedAt"
)
SELECT
    'srp_' || md5(source."organizationId" || ':' || source."id" || ':entry'),
    source."organizationId",
    'source:' || source."id" || ':entry',
    source."id",
    NULLIF(source."settings"->>'scenarioId', ''),
    source."platform",
    CASE
      WHEN source."platform" = 'telegram' THEN 'READ_THREAD'
      WHEN source."collectionMode" = 'official_api'
        AND source."ownership" = 'owned'
        AND source."platform" IN ('facebook', 'instagram', 'tiktok', 'youtube')
        THEN 'READ_OWNED_COMMENTS'
      WHEN source."collectionMode" = 'official_api'
        AND source."platform" IN ('youtube', 'vkontakte')
        THEN 'READ_EXTERNAL_COMMENTS'
      ELSE 'DISCOVER_POSTS'
    END,
    CASE WHEN source."ownership" = 'owned' THEN 'OWNED' ELSE 'PUBLIC' END,
    CASE
      WHEN source."collectionMode" = 'official_api' AND source."platform" IN ('facebook', 'instagram') THEN 'META_GRAPH'
      WHEN source."collectionMode" = 'official_api' AND source."platform" = 'youtube' THEN 'YOUTUBE_DATA_API'
      WHEN source."collectionMode" = 'official_api' AND source."platform" = 'vkontakte' THEN 'VK_API'
      WHEN source."collectionMode" = 'official_api' AND source."platform" = 'telegram' THEN 'TELEGRAM_BOT_API'
      WHEN source."collectionMode" = 'official_api' AND source."platform" = 'tiktok' THEN 'TIKTOK_BUSINESS_API'
      WHEN source."collectionMode" = 'official_api' AND source."platform" = 'twitter' THEN 'X_API'
      WHEN source."collectionMode" = 'provider_api' THEN 'LICENSED_PROVIDER'
      WHEN source."collectionMode" = 'search_index'
        AND source."platform" IN ('facebook', 'instagram', 'tiktok')
        AND EXISTS (
          SELECT 1 FROM "channel_configs" AS cfg
          WHERE cfg."organizationId" = source."organizationId"
            AND cfg."channelType" = 'social_monitoring'
            AND cfg."configName" = 'Monitoring providers'
            AND cfg."settings"#>>'{searchIndex,provider}' = 'apify'
            AND cfg."settings"#>>'{searchIndex,enabled}' = 'true'
            AND cfg."apiKey" IS NOT NULL
        ) THEN 'APIFY_ASYNC'
      WHEN source."collectionMode" = 'search_index' THEN 'SEARCH_INDEX_GENERIC'
      WHEN source."collectionMode" = 'notification_inbox' THEN 'NOTIFICATION_INBOX'
      WHEN source."collectionMode" = 'browser_capture' THEN 'BROWSER_CAPTURE_READ_ONLY'
      ELSE 'MANUAL_TASK'
    END,
    CASE
      WHEN source."collectionMode" = 'search_index'
        AND source."platform" IN ('facebook', 'instagram', 'tiktok')
        THEN ARRAY['MANUAL_TASK']::TEXT[]
      ELSE ARRAY[]::TEXT[]
    END,
    CASE
      WHEN NULLIF(COALESCE(source."settings"->>'socialAccountId', source."settings"->>'accountId'), '') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "social_accounts" account
          WHERE account."organizationId" = source."organizationId"
            AND account."id" = COALESCE(source."settings"->>'socialAccountId', source."settings"->>'accountId')
        ) THEN COALESCE(source."settings"->>'socialAccountId', source."settings"->>'accountId')
      ELSE NULL
    END,
    CASE
      WHEN source."collectionMode" = 'official_api' THEN 'OFFICIAL_API'
      WHEN source."collectionMode" = 'provider_api' THEN 'LICENSED_PROVIDER'
      WHEN source."collectionMode" = 'search_index'
        AND source."platform" IN ('facebook', 'instagram', 'tiktok') THEN 'APIFY_FALLBACK'
      ELSE 'MANUAL_URL'
    END,
    'NO_ACTION',
    0,
    jsonb_build_object('maxItems', 100, 'maxTotalChargeUsd', 1, 'dailyBudgetUsd', 5, 'monthlyBudgetUsd', 50),
    jsonb_build_object('maxRequestsPerMinute', 30),
    GREATEST(source."cadenceMinutes", 15),
    ARRAY['RATE_LIMIT', 'TRANSIENT_ERROR', 'PROVIDER_OUTAGE']::TEXT[],
    'social-monitoring-v2-pr2',
    CASE
      WHEN source."collectionMode" = 'provider_api' THEN 'Licensed provider route requires a verified capability proof before activation.'
      WHEN source."platform" = 'twitter' AND source."collectionMode" = 'search_index' THEN 'X search has no approved scraper fallback; configure official or licensed access.'
      ELSE 'Fail-closed migration placeholder; the deterministic compiler must verify current credentials, proofs and tenant settings before activation.'
    END,
    'BLOCKED',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "monitoring_sources" AS source;

-- Every new tenant table is fail-closed under RLS. Application transactions
-- must set app.org_id; trusted maintenance may set app.rls_bypass=on.
ALTER TABLE "social_provider_capability_proofs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_provider_capability_proofs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "source_route_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_route_plans" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_provider_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_provider_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ingest_envelopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingest_envelopes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "rejected_observation_fingerprints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rejected_observation_fingerprints" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_deletion_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_deletion_ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "social_connection_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_connection_cursors" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "social_provider_capability_proofs"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "tenant_isolation" ON "source_route_plans"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "tenant_isolation" ON "social_provider_runs"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "tenant_isolation" ON "ingest_envelopes"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "tenant_isolation" ON "rejected_observation_fingerprints"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "tenant_isolation" ON "social_deletion_ledger_entries"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY "tenant_isolation" ON "social_connection_cursors"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

SELECT set_config('app.rls_bypass', 'off', false);
