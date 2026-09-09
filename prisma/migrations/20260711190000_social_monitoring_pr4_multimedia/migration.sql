-- Social Monitoring V2 PR4: policy-bound multimedia discovery.
-- Paid stages remain disabled and budgeted at zero for every existing tenant.

SELECT set_config('app.rls_bypass', 'on', false);

CREATE TABLE "visual_references" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "referenceType" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "contentHmac" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "processingAllowed" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visual_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visual_references_type_check" CHECK ("referenceType" IN ('LOGO', 'PRODUCT_PACKAGING', 'NAME_CARD', 'MANUAL_CONTEXT')),
  CONSTRAINT "visual_references_status_check" CHECK ("status" IN ('active', 'paused', 'archived'))
);

CREATE TABLE "discovery_leads" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectId" TEXT,
  "sourceId" TEXT,
  "leadType" TEXT NOT NULL,
  "submittedUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "platformHint" TEXT,
  "mediaType" TEXT NOT NULL DEFAULT 'AUTO',
  "title" TEXT,
  "thumbnailUrl" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "decisionReason" TEXT,
  "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  "candidateMetadata" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "purgeAt" TIMESTAMP(3) NOT NULL,
  "purgedAt" TIMESTAMP(3),
  CONSTRAINT "discovery_leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discovery_leads_type_check" CHECK ("leadType" IN ('MANUAL_URL', 'IMAGE_SEARCH_RESULT', 'MANUAL_UPLOAD')),
  CONSTRAINT "discovery_leads_media_type_check" CHECK ("mediaType" IN ('AUTO', 'IMAGE', 'VIDEO', 'AUDIO')),
  CONSTRAINT "discovery_leads_status_check" CHECK ("status" IN ('NEW', 'VALIDATED', 'QUEUED', 'REJECTED', 'INGESTED', 'PURGED'))
);

CREATE TABLE "media_observations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT,
  "discoveryLeadId" TEXT,
  "subjectId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "platform" TEXT,
  "mediaType" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "canonicalMediaUrl" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "audioUrl" TEXT,
  "platformTranscript" TEXT,
  "language" TEXT,
  "durationMs" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "currentStage" TEXT NOT NULL DEFAULT 'METADATA',
  "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "extractionPlan" JSONB NOT NULL DEFAULT '{}',
  "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  "contentHmac" TEXT NOT NULL,
  "retentionClass" TEXT NOT NULL DEFAULT 'MEDIA_30D',
  "purgeAt" TIMESTAMP(3) NOT NULL,
  "purgedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "claimVersion" INTEGER NOT NULL DEFAULT 0,
  "claimExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_observations_parent_check" CHECK ("mentionId" IS NOT NULL OR "discoveryLeadId" IS NOT NULL),
  CONSTRAINT "media_observations_type_check" CHECK ("mediaType" IN ('IMAGE', 'VIDEO', 'AUDIO')),
  CONSTRAINT "media_observations_status_check" CHECK ("status" IN ('QUEUED', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED', 'BLOCKED', 'DROPPED', 'PURGED')),
  CONSTRAINT "media_observations_score_check" CHECK ("relevanceScore" >= 0 AND "relevanceScore" <= 1),
  CONSTRAINT "media_observations_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  CONSTRAINT "media_observations_claim_version_check" CHECK ("claimVersion" >= 0)
);

CREATE TABLE "media_signals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "subjectId" TEXT,
  "signalType" TEXT NOT NULL,
  "text" TEXT,
  "startMs" INTEGER,
  "endMs" INTEGER,
  "frameIndex" INTEGER,
  "confidence" DOUBLE PRECISION NOT NULL,
  "provider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "language" TEXT,
  "matchedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "retentionClass" TEXT NOT NULL DEFAULT 'MEDIA_SIGNAL_180D',
  "purgeAt" TIMESTAMP(3) NOT NULL,
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_signals_type_check" CHECK ("signalType" IN ('COVER_OCR', 'FRAME_OCR', 'ASR', 'PLATFORM_CAPTION', 'LOGO_MATCH', 'MANUAL_NOTE')),
  CONSTRAINT "media_signals_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "media_signals_time_check" CHECK (("startMs" IS NULL OR "startMs" >= 0) AND ("endMs" IS NULL OR "endMs" >= 0) AND ("startMs" IS NULL OR "endMs" IS NULL OR "startMs" <= "endMs")),
  CONSTRAINT "media_signals_frame_check" CHECK ("frameIndex" IS NULL OR "frameIndex" >= 0)
);

CREATE TABLE "media_processing_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "frameCount" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "reservedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "actualCostUsd" DECIMAL(12,6),
  "inputSnapshot" JSONB NOT NULL DEFAULT '{}',
  "outputSummary" JSONB NOT NULL DEFAULT '{}',
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_processing_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_processing_runs_stage_check" CHECK ("stage" IN ('COVER_OCR', 'FRAME_SAMPLE', 'FRAME_OCR', 'PLATFORM_TRANSCRIPT', 'ASR', 'MULTIMODAL')),
  CONSTRAINT "media_processing_runs_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED', 'BLOCKED_BUDGET')),
  CONSTRAINT "media_processing_runs_cost_check" CHECK ("estimatedCostUsd" >= 0 AND "reservedCostUsd" >= 0 AND ("actualCostUsd" IS NULL OR "actualCostUsd" >= 0)),
  CONSTRAINT "media_processing_runs_frame_check" CHECK ("frameCount" >= 0)
);

CREATE TABLE "media_processing_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "coverOcrEnabled" BOOLEAN NOT NULL DEFAULT true,
  "frameOcrEnabled" BOOLEAN NOT NULL DEFAULT false,
  "asrEnabled" BOOLEAN NOT NULL DEFAULT false,
  "multimodalEnabled" BOOLEAN NOT NULL DEFAULT false,
  "preferPlatformTranscript" BOOLEAN NOT NULL DEFAULT true,
  "dailyBudgetUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "monthlyBudgetUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "perObservationBudgetUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "maxFramesPerVideo" INTEGER NOT NULL DEFAULT 8,
  "frameCandidatePercent" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "asrCandidatePercent" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "multimodalCandidatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "maxMediaBytes" INTEGER NOT NULL DEFAULT 26214400,
  "mediaRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "signalRetentionDays" INTEGER NOT NULL DEFAULT 180,
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_processing_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_processing_policies_budget_check" CHECK ("dailyBudgetUsd" >= 0 AND "monthlyBudgetUsd" >= 0 AND "perObservationBudgetUsd" >= 0),
  CONSTRAINT "media_processing_policies_frame_check" CHECK ("maxFramesPerVideo" BETWEEN 1 AND 24),
  CONSTRAINT "media_processing_policies_percent_check" CHECK ("frameCandidatePercent" BETWEEN 0 AND 100 AND "asrCandidatePercent" BETWEEN 0 AND 100 AND "multimodalCandidatePercent" BETWEEN 0 AND 100),
  CONSTRAINT "media_processing_policies_retention_check" CHECK ("mediaRetentionDays" BETWEEN 1 AND 180 AND "signalRetentionDays" BETWEEN 1 AND 730),
  CONSTRAINT "media_processing_policies_bytes_check" CHECK ("maxMediaBytes" BETWEEN 1024 AND 104857600)
);

CREATE INDEX "visual_references_subject_status_idx" ON "visual_references"("organizationId", "subjectId", "status");
CREATE UNIQUE INDEX "visual_references_org_id_key" ON "visual_references"("organizationId", "id");
CREATE UNIQUE INDEX "visual_references_org_subject_hmac_key" ON "visual_references"("organizationId", "subjectId", "contentHmac");
CREATE INDEX "discovery_leads_status_idx" ON "discovery_leads"("organizationId", "status", "createdAt");
CREATE INDEX "discovery_leads_subject_idx" ON "discovery_leads"("organizationId", "subjectId", "createdAt");
CREATE INDEX "discovery_leads_purge_idx" ON "discovery_leads"("organizationId", "purgeAt", "purgedAt");
CREATE UNIQUE INDEX "discovery_leads_org_id_key" ON "discovery_leads"("organizationId", "id");
CREATE UNIQUE INDEX "discovery_leads_org_canonical_url_key" ON "discovery_leads"("organizationId", "canonicalUrl");
CREATE INDEX "media_observations_queue_idx" ON "media_observations"("organizationId", "status", "priority", "createdAt");
CREATE INDEX "media_observations_mention_idx" ON "media_observations"("organizationId", "mentionId");
CREATE INDEX "media_observations_subject_idx" ON "media_observations"("organizationId", "subjectId", "createdAt");
CREATE INDEX "media_observations_purge_idx" ON "media_observations"("organizationId", "purgeAt", "purgedAt");
CREATE UNIQUE INDEX "media_observations_org_id_key" ON "media_observations"("organizationId", "id");
CREATE UNIQUE INDEX "media_observations_org_idempotency_key" ON "media_observations"("organizationId", "idempotencyKey");
CREATE INDEX "media_signals_observation_type_idx" ON "media_signals"("organizationId", "observationId", "signalType");
CREATE INDEX "media_signals_subject_idx" ON "media_signals"("organizationId", "subjectId", "createdAt");
CREATE INDEX "media_signals_purge_idx" ON "media_signals"("organizationId", "purgeAt", "purgedAt");
CREATE UNIQUE INDEX "media_signals_org_id_key" ON "media_signals"("organizationId", "id");
CREATE INDEX "media_processing_runs_status_idx" ON "media_processing_runs"("organizationId", "status", "createdAt");
CREATE INDEX "media_processing_runs_observation_stage_idx" ON "media_processing_runs"("organizationId", "observationId", "stage");
CREATE UNIQUE INDEX "media_processing_runs_org_id_key" ON "media_processing_runs"("organizationId", "id");
CREATE UNIQUE INDEX "media_processing_runs_org_idempotency_key" ON "media_processing_runs"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "media_processing_policies_organizationId_key" ON "media_processing_policies"("organizationId");

ALTER TABLE "visual_references" ADD CONSTRAINT "visual_references_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visual_references" ADD CONSTRAINT "visual_references_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_leads" ADD CONSTRAINT "discovery_leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_leads" ADD CONSTRAINT "discovery_leads_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "discovery_leads" ADD CONSTRAINT "discovery_leads_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "monitoring_sources"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "media_observations" ADD CONSTRAINT "media_observations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_observations" ADD CONSTRAINT "media_observations_organizationId_mentionId_fkey" FOREIGN KEY ("organizationId", "mentionId") REFERENCES "social_mentions"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "media_observations" ADD CONSTRAINT "media_observations_organizationId_discoveryLeadId_fkey" FOREIGN KEY ("organizationId", "discoveryLeadId") REFERENCES "discovery_leads"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "media_observations" ADD CONSTRAINT "media_observations_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "media_signals" ADD CONSTRAINT "media_signals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_signals" ADD CONSTRAINT "media_signals_organizationId_observationId_fkey" FOREIGN KEY ("organizationId", "observationId") REFERENCES "media_observations"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_signals" ADD CONSTRAINT "media_signals_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "media_processing_runs" ADD CONSTRAINT "media_processing_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_processing_runs" ADD CONSTRAINT "media_processing_runs_organizationId_observationId_fkey" FOREIGN KEY ("organizationId", "observationId") REFERENCES "media_observations"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_processing_policies" ADD CONSTRAINT "media_processing_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "media_processing_policies" ("id", "organizationId", "updatedAt")
SELECT 'media-policy-' || id, id, CURRENT_TIMESTAMP FROM "organizations"
ON CONFLICT ("organizationId") DO NOTHING;

ALTER TABLE "visual_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visual_references" FORCE ROW LEVEL SECURITY;
CREATE POLICY "visual_references_tenant_isolation" ON "visual_references" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "discovery_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "discovery_leads_tenant_isolation" ON "discovery_leads" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "media_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_observations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "media_observations_tenant_isolation" ON "media_observations" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "media_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "media_signals_tenant_isolation" ON "media_signals" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "media_processing_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_processing_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "media_processing_runs_tenant_isolation" ON "media_processing_runs" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "media_processing_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_processing_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "media_processing_policies_tenant_isolation" ON "media_processing_policies" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));

SELECT set_config('app.rls_bypass', 'off', false);
