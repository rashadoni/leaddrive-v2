-- Explicit inbox customer lifecycle. Nullable stage means "not classified yet";
-- it is intentionally different from the operational Gözləmədə folder.
ALTER TABLE "social_conversations"
  ADD COLUMN "customerStage" TEXT,
  ADD COLUMN "customerStageSource" TEXT,
  ADD COLUMN "customerStageConfidence" DOUBLE PRECISION,
  ADD COLUMN "customerStageReason" TEXT,
  ADD COLUMN "customerStageUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "customerStageUpdatedBy" TEXT,
  ADD COLUMN "aiSuggestedCustomerStage" TEXT,
  ADD COLUMN "aiCustomerStageConfidence" DOUBLE PRECISION,
  ADD COLUMN "aiCustomerStageReason" TEXT,
  ADD COLUMN "aiCustomerStageSuggestedAt" TIMESTAMP(3);

ALTER TABLE "social_conversations"
  ADD CONSTRAINT "social_conversations_customer_stage_check"
  CHECK (
    "customerStage" IS NULL OR "customerStage" IN (
      'interested',
      'potential',
      'sales_contacted',
      'unable_to_contact',
      'sold',
      'not_sold',
      'no_result'
    )
  ),
  ADD CONSTRAINT "social_conversations_customer_stage_source_check"
  CHECK (
    "customerStageSource" IS NULL OR "customerStageSource" IN ('agent', 'ai', 'system', 'backfill')
  ),
  ADD CONSTRAINT "social_conversations_customer_stage_confidence_check"
  CHECK (
    "customerStageConfidence" IS NULL OR
    ("customerStageConfidence" >= 0 AND "customerStageConfidence" <= 1)
  ),
  ADD CONSTRAINT "social_conversations_ai_customer_stage_check"
  CHECK (
    "aiSuggestedCustomerStage" IS NULL OR "aiSuggestedCustomerStage" IN (
      'interested',
      'potential',
      'no_result'
    )
  ),
  ADD CONSTRAINT "social_conversations_ai_customer_stage_confidence_check"
  CHECK (
    "aiCustomerStageConfidence" IS NULL OR
    ("aiCustomerStageConfidence" >= 0 AND "aiCustomerStageConfidence" <= 1)
  );

CREATE INDEX "social_conversations_organizationId_customerStage_idx"
  ON "social_conversations"("organizationId", "customerStage");

CREATE TABLE "inbox_customer_stage_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "fromStage" TEXT,
  "toStage" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "reason" TEXT,
  "changedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_customer_stage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inbox_customer_stage_events_stage_check" CHECK (
    "toStage" IN (
      'interested',
      'potential',
      'sales_contacted',
      'unable_to_contact',
      'sold',
      'not_sold',
      'no_result'
    )
    AND (
      "fromStage" IS NULL OR "fromStage" IN (
        'interested',
        'potential',
        'sales_contacted',
        'unable_to_contact',
        'sold',
        'not_sold',
        'no_result'
      )
    )
  ),
  CONSTRAINT "inbox_customer_stage_events_source_check"
    CHECK ("source" IN ('agent', 'ai', 'system', 'backfill')),
  CONSTRAINT "inbox_customer_stage_events_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE INDEX "inbox_customer_stage_events_organizationId_createdAt_idx"
  ON "inbox_customer_stage_events"("organizationId", "createdAt");
CREATE INDEX "inbox_customer_stage_events_conversationId_createdAt_idx"
  ON "inbox_customer_stage_events"("conversationId", "createdAt");

ALTER TABLE "inbox_customer_stage_events"
  ADD CONSTRAINT "inbox_customer_stage_events_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "social_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbox_customer_stage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_customer_stage_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inbox_customer_stage_events_tenant_isolation"
  ON "inbox_customer_stage_events"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
