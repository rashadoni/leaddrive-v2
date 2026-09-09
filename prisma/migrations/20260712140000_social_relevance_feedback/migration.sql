-- CR-2.2: tenant-scoped operator feedback for social relevance decisions.
-- The table deliberately stores no mention text, raw payload, prompt, embedding,
-- or reusable agent-memory content.

CREATE TABLE "social_relevance_feedback" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mentionId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "feedbackType" TEXT NOT NULL,
  "relevanceStatus" TEXT NOT NULL,
  "matcherVersion" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "decidedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "social_relevance_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_relevance_feedback_type_check" CHECK (
    "feedbackType" IN ('RELEVANT', 'NOT_RELEVANT', 'DUPLICATE', 'WRONG_SUBJECT', 'MISSED_RISK')
  ),
  CONSTRAINT "social_relevance_feedback_status_check" CHECK (
    "relevanceStatus" IN ('PENDING', 'ACCEPTED', 'REVIEW', 'REJECTED', 'POLICY_DENIED', 'DELETED_AT_SOURCE', 'PURGED')
  )
);

CREATE UNIQUE INDEX "social_relevance_feedback_org_id_key"
  ON "social_relevance_feedback"("organizationId", "id");
CREATE UNIQUE INDEX "social_relevance_feedback_org_mention_subject_key"
  ON "social_relevance_feedback"("organizationId", "mentionId", "subjectId");
CREATE INDEX "social_relevance_feedback_quality_idx"
  ON "social_relevance_feedback"("organizationId", "subjectId", "platform", "updatedAt");
CREATE INDEX "social_relevance_feedback_type_idx"
  ON "social_relevance_feedback"("organizationId", "feedbackType", "updatedAt");

ALTER TABLE "social_relevance_feedback"
  ADD CONSTRAINT "social_relevance_feedback_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_relevance_feedback"
  ADD CONSTRAINT "social_relevance_feedback_organizationId_mentionId_fkey"
  FOREIGN KEY ("organizationId", "mentionId")
  REFERENCES "social_mentions"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_relevance_feedback"
  ADD CONSTRAINT "social_relevance_feedback_organizationId_subjectId_fkey"
  FOREIGN KEY ("organizationId", "subjectId")
  REFERENCES "monitoring_subjects"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_relevance_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_relevance_feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "social_relevance_feedback_tenant_isolation"
  ON "social_relevance_feedback"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
