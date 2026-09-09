-- PR5: legal candidates, immutable case dossier, subject-bound AI draft snapshots
-- and manual engagement tasks. All new outbound-facing state remains workflow
-- metadata only; this migration cannot enable a publisher.

SELECT set_config('app.rls_bypass', 'on', false);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "social_legal_cases"
  ADD COLUMN "candidateId" TEXT,
  ADD COLUMN "subjectId" TEXT;

ALTER TABLE "social_mention_ai_drafts"
  ADD COLUMN "agentConfigId" TEXT,
  ADD COLUMN "agentSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "engagementMode" TEXT NOT NULL DEFAULT 'MANUAL_REVIEW',
  ADD COLUMN "knowledgeSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "mentionContentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "modelSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "promptSnapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "replyOptions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "routingRecommendation" TEXT,
  ADD COLUMN "subjectId" TEXT;

CREATE TABLE "social_legal_candidates" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "subjectId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "category" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "severity" INTEGER NOT NULL DEFAULT 0,
  "rationale" TEXT,
  "classifierVersion" TEXT,
  "classifierSnapshot" JSONB NOT NULL DEFAULT '{}',
  "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  "suggestedActions" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_legal_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_legal_candidates_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "social_legal_candidates_severity_check" CHECK ("severity" >= 0 AND "severity" <= 100),
  CONSTRAINT "social_legal_candidates_status_check" CHECK ("status" IN ('NEW','AI_REVIEWED','HUMAN_REVIEW','PROMOTED','DISMISSED'))
);

CREATE TABLE "social_legal_evidences" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT,
  "candidateId" TEXT,
  "mentionEvidenceId" TEXT,
  "evidenceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "contentSnapshot" JSONB NOT NULL DEFAULT '{}',
  "contentSha256" TEXT NOT NULL,
  "sourceTrustTier" TEXT NOT NULL DEFAULT 'T6',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedBy" TEXT,
  "legalHold" BOOLEAN NOT NULL DEFAULT true,
  "purgeAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_legal_evidences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_legal_evidences_parent_check" CHECK ("caseId" IS NOT NULL OR "candidateId" IS NOT NULL),
  CONSTRAINT "social_legal_evidences_type_check" CHECK ("evidenceType" IN ('MENTION_SNAPSHOT','PERMALINK','SCREENSHOT','MEDIA_SIGNAL','MANUAL_NOTE'))
);

CREATE TABLE "social_legal_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actorId" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_legal_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_legal_events_actor_type_check" CHECK ("actorType" IN ('USER','AI','SYSTEM'))
);

CREATE TABLE "social_legal_actions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "content" TEXT,
  "rationale" TEXT,
  "recommendationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "aiSnapshot" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_legal_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_legal_actions_score_check" CHECK ("recommendationScore" >= 0 AND "recommendationScore" <= 1),
  CONSTRAINT "social_legal_actions_type_check" CHECK ("actionType" IN ('REPLY_DRAFT','NO_REPLY','ROUTE_LEGAL','REPORT','MANUAL_ENGAGEMENT')),
  CONSTRAINT "social_legal_actions_status_check" CHECK ("status" IN ('PROPOSED','SELECTED','APPROVED','REJECTED','COMPLETED'))
);

CREATE TABLE "social_legal_approvals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actionId" TEXT,
  "decision" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL DEFAULT '{}',
  "approvedBy" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_legal_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_legal_approvals_decision_check" CHECK ("decision" IN ('APPROVED','REJECTED','CHANGES_REQUESTED'))
);

CREATE TABLE "social_legal_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "candidateThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
  "autoPromote" BOOLEAN NOT NULL DEFAULT false,
  "requireHumanReview" BOOLEAN NOT NULL DEFAULT true,
  "allowedCategories" TEXT[] DEFAULT ARRAY['insult','defamation','false_accusation','threat']::TEXT[],
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_legal_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_legal_policies_threshold_check" CHECK ("candidateThreshold" >= 0 AND "candidateThreshold" <= 1),
  CONSTRAINT "social_legal_policies_human_gate_check" CHECK (NOT "autoPromote" AND "requireHumanReview")
);

CREATE TABLE "manual_engagement_tasks" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "subjectId" TEXT,
  "draftId" TEXT,
  "platform" TEXT NOT NULL,
  "engagementMode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "targetUrl" TEXT,
  "instructions" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "assignedTo" TEXT,
  "completedBy" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manual_engagement_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_engagement_tasks_mode_check" CHECK ("engagementMode" IN ('MANUAL_EXTERNAL','MANUAL_REVIEW')),
  CONSTRAINT "manual_engagement_tasks_status_check" CHECK ("status" IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
);

CREATE UNIQUE INDEX "mention_evidence_org_id_key" ON "mention_evidence"("organizationId", "id");
CREATE UNIQUE INDEX "social_legal_candidates_org_id_key" ON "social_legal_candidates"("organizationId", "id");
CREATE UNIQUE INDEX "social_legal_candidates_org_mention_key" ON "social_legal_candidates"("organizationId", "mentionId");
CREATE INDEX "social_legal_candidates_org_queue_idx" ON "social_legal_candidates"("organizationId", "status", "confidence", "createdAt");
CREATE INDEX "social_legal_candidates_org_subject_status_idx" ON "social_legal_candidates"("organizationId", "subjectId", "status");
CREATE UNIQUE INDEX "social_legal_evidences_org_id_key" ON "social_legal_evidences"("organizationId", "id");
CREATE UNIQUE INDEX "social_legal_evidences_org_sha_key" ON "social_legal_evidences"("organizationId", "contentSha256");
CREATE INDEX "social_legal_evidences_org_case_captured_idx" ON "social_legal_evidences"("organizationId", "caseId", "capturedAt");
CREATE INDEX "social_legal_evidences_org_candidate_captured_idx" ON "social_legal_evidences"("organizationId", "candidateId", "capturedAt");
CREATE UNIQUE INDEX "social_legal_events_org_id_key" ON "social_legal_events"("organizationId", "id");
CREATE INDEX "social_legal_events_org_case_created_idx" ON "social_legal_events"("organizationId", "caseId", "createdAt");
CREATE UNIQUE INDEX "social_legal_actions_org_id_key" ON "social_legal_actions"("organizationId", "id");
CREATE INDEX "social_legal_actions_org_case_status_idx" ON "social_legal_actions"("organizationId", "caseId", "status");
CREATE UNIQUE INDEX "social_legal_approvals_org_id_key" ON "social_legal_approvals"("organizationId", "id");
CREATE INDEX "social_legal_approvals_org_case_created_idx" ON "social_legal_approvals"("organizationId", "caseId", "createdAt");
CREATE UNIQUE INDEX "social_legal_policies_organizationId_key" ON "social_legal_policies"("organizationId");
CREATE UNIQUE INDEX "manual_engagement_tasks_org_id_key" ON "manual_engagement_tasks"("organizationId", "id");
CREATE UNIQUE INDEX "manual_engagement_tasks_org_mention_draft_key" ON "manual_engagement_tasks"("organizationId", "mentionId", "draftId");
CREATE INDEX "manual_engagement_tasks_org_status_created_idx" ON "manual_engagement_tasks"("organizationId", "status", "createdAt");
CREATE INDEX "manual_engagement_tasks_org_subject_status_idx" ON "manual_engagement_tasks"("organizationId", "subjectId", "status");
CREATE UNIQUE INDEX "social_legal_cases_org_candidate_key" ON "social_legal_cases"("organizationId", "candidateId");
CREATE INDEX "social_legal_cases_org_subject_status_idx" ON "social_legal_cases"("organizationId", "subjectId", "status");
CREATE INDEX "social_mention_ai_drafts_org_subject_created_idx" ON "social_mention_ai_drafts"("organizationId", "subjectId", "createdAt");

ALTER TABLE "social_mention_ai_drafts" ADD CONSTRAINT "social_mention_ai_drafts_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "social_legal_candidates" ADD CONSTRAINT "social_legal_candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_candidates" ADD CONSTRAINT "social_legal_candidates_organizationId_mentionId_fkey" FOREIGN KEY ("organizationId", "mentionId") REFERENCES "social_mentions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_candidates" ADD CONSTRAINT "social_legal_candidates_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "social_legal_evidences" ADD CONSTRAINT "social_legal_evidences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_evidences" ADD CONSTRAINT "social_legal_evidences_organizationId_caseId_fkey" FOREIGN KEY ("organizationId", "caseId") REFERENCES "social_legal_cases"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_evidences" ADD CONSTRAINT "social_legal_evidences_organizationId_candidateId_fkey" FOREIGN KEY ("organizationId", "candidateId") REFERENCES "social_legal_candidates"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_evidences" ADD CONSTRAINT "social_legal_evidences_organizationId_mentionEvidenceId_fkey" FOREIGN KEY ("organizationId", "mentionEvidenceId") REFERENCES "mention_evidence"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "social_legal_events" ADD CONSTRAINT "social_legal_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_events" ADD CONSTRAINT "social_legal_events_organizationId_caseId_fkey" FOREIGN KEY ("organizationId", "caseId") REFERENCES "social_legal_cases"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_actions" ADD CONSTRAINT "social_legal_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_actions" ADD CONSTRAINT "social_legal_actions_organizationId_caseId_fkey" FOREIGN KEY ("organizationId", "caseId") REFERENCES "social_legal_cases"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_approvals" ADD CONSTRAINT "social_legal_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_approvals" ADD CONSTRAINT "social_legal_approvals_organizationId_caseId_fkey" FOREIGN KEY ("organizationId", "caseId") REFERENCES "social_legal_cases"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_legal_approvals" ADD CONSTRAINT "social_legal_approvals_organizationId_actionId_fkey" FOREIGN KEY ("organizationId", "actionId") REFERENCES "social_legal_actions"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "social_legal_policies" ADD CONSTRAINT "social_legal_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_engagement_tasks" ADD CONSTRAINT "manual_engagement_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_engagement_tasks" ADD CONSTRAINT "manual_engagement_tasks_organizationId_mentionId_fkey" FOREIGN KEY ("organizationId", "mentionId") REFERENCES "social_mentions"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manual_engagement_tasks" ADD CONSTRAINT "manual_engagement_tasks_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "manual_engagement_tasks" ADD CONSTRAINT "manual_engagement_tasks_organizationId_draftId_fkey" FOREIGN KEY ("organizationId", "draftId") REFERENCES "social_mention_ai_drafts"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Existing manually flagged cases become promoted candidates and receive an
-- immutable mention snapshot. This preserves old reports while moving all
-- future dossier work onto the many-evidence contract.
INSERT INTO "social_legal_candidates" (
  "id", "organizationId", "mentionId", "subjectId", "status", "category",
  "confidence", "severity", "rationale", "classifierVersion",
  "classifierSnapshot", "policySnapshot", "suggestedActions", "createdBy",
  "reviewedBy", "reviewedAt", "createdAt", "updatedAt"
)
SELECT
  'pr5-candidate-' || c.id,
  c."organizationId",
  c."mentionId",
  match."subjectId",
  'PROMOTED',
  c.category,
  CASE WHEN c."aiSuggested" THEN 0.7 ELSE 1 END,
  CASE c.category WHEN 'threat' THEN 100 WHEN 'defamation' THEN 80 WHEN 'false_accusation' THEN 70 WHEN 'insult' THEN 50 ELSE 25 END,
  'legacy_manual_case_backfill',
  'legacy-v1',
  jsonb_build_object('legacyCaseId', c.id, 'aiSuggested', c."aiSuggested"),
  jsonb_build_object('requireHumanReview', true, 'autoPromote', false),
  '["ROUTE_LEGAL","NO_REPLY"]'::jsonb,
  c."flaggedBy", c."flaggedBy", c."createdAt", c."createdAt", c."updatedAt"
FROM "social_legal_cases" c
LEFT JOIN LATERAL (
  SELECT m."subjectId"
  FROM "social_mention_subject_matches" m
  WHERE m."organizationId" = c."organizationId" AND m."mentionId" = c."mentionId" AND m.status = 'MATCHED'
  ORDER BY m.confidence DESC, m."createdAt" ASC
  LIMIT 1
) match ON true;

UPDATE "social_legal_cases" c
SET "candidateId" = 'pr5-candidate-' || c.id,
    "subjectId" = candidate."subjectId"
FROM "social_legal_candidates" candidate
WHERE candidate.id = 'pr5-candidate-' || c.id
  AND candidate."organizationId" = c."organizationId";

INSERT INTO "social_legal_evidences" (
  "id", "organizationId", "caseId", "candidateId", "evidenceType",
  "sourceUrl", "contentSnapshot", "contentSha256", "sourceTrustTier",
  "capturedAt", "capturedBy", "legalHold", "createdAt"
)
SELECT
  'pr5-evidence-' || c.id,
  c."organizationId",
  c.id,
  c."candidateId",
  'MENTION_SNAPSHOT',
  COALESCE(m.url, m."canonicalUrl"),
  jsonb_build_object(
    'mentionId', m.id, 'platform', m.platform, 'sourceType', m."sourceType",
    'text', m.text, 'authorName', m."authorName", 'authorHandle', m."authorHandle",
    'publishedAt', m."publishedAt", 'contentVersion', m."contentVersion"
  ),
  encode(digest(concat_ws('|', c."organizationId", m.id, m."contentVersion"::text, m.text), 'sha256'), 'hex'),
  'T6', c."createdAt", c."flaggedBy", true, c."createdAt"
FROM "social_legal_cases" c
JOIN "social_mentions" m ON m.id = c."mentionId" AND m."organizationId" = c."organizationId";

INSERT INTO "social_legal_events" (
  "id", "organizationId", "caseId", "eventType", "actorType", "actorId",
  "toStatus", "payload", "createdAt"
)
SELECT 'pr5-event-' || c.id, c."organizationId", c.id, 'LEGACY_CASE_MIGRATED',
       'SYSTEM', c."flaggedBy", c.status,
       jsonb_build_object('candidateId', c."candidateId"), c."createdAt"
FROM "social_legal_cases" c;

ALTER TABLE "social_legal_cases" ADD CONSTRAINT "social_legal_cases_organizationId_subjectId_fkey" FOREIGN KEY ("organizationId", "subjectId") REFERENCES "monitoring_subjects"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "social_legal_cases" ADD CONSTRAINT "social_legal_cases_organizationId_candidateId_fkey" FOREIGN KEY ("organizationId", "candidateId") REFERENCES "social_legal_candidates"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

INSERT INTO "social_legal_policies" (
  "id", "organizationId", "enabled", "candidateThreshold", "autoPromote",
  "requireHumanReview", "allowedCategories", "policyVersion", "createdAt", "updatedAt"
)
SELECT 'pr5-legal-policy-' || id, id, true, 0.65, false, true,
       ARRAY['insult','defamation','false_accusation','threat']::TEXT[], 1, NOW(), NOW()
FROM organizations
ON CONFLICT ("organizationId") DO NOTHING;

ALTER TABLE "social_mention_ai_drafts" ADD CONSTRAINT "social_mention_ai_drafts_engagement_mode_check" CHECK ("engagementMode" IN ('OWNED_DIRECT','PROVIDER_REPLY','MANUAL_EXTERNAL','MANUAL_REVIEW','NO_REPLY'));

-- Forced tenant isolation. Policies use the request-local app.org_id set by
-- the Prisma RLS extension; absence of context matches zero rows.
DO $rls$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'social_legal_candidates', 'social_legal_evidences', 'social_legal_events',
    'social_legal_actions', 'social_legal_approvals', 'social_legal_policies',
    'manual_engagement_tasks'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organizationId" = current_setting(''app.org_id'', true)) WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $rls$;

SELECT set_config('app.rls_bypass', 'off', false);
