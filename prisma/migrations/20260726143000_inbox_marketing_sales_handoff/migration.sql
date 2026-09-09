-- Separate a real marketing chat reply from a salesperson's phone-call report.
-- AI remains advisory; salesperson-confirmed outcomes are stored on Lead and
-- mirrored to every Inbox conversation linked to that lead.

ALTER TABLE "social_conversations"
  DROP CONSTRAINT "social_conversations_customer_stage_check",
  DROP CONSTRAINT "social_conversations_customer_stage_source_check";

ALTER TABLE "inbox_customer_stage_events"
  DROP CONSTRAINT "inbox_customer_stage_events_stage_check",
  DROP CONSTRAINT "inbox_customer_stage_events_source_check";

ALTER TABLE "leads"
  ADD COLUMN "customerStage" TEXT,
  ADD COLUMN "customerStageReason" TEXT,
  ADD COLUMN "customerStageUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "customerStageUpdatedBy" TEXT,
  ADD COLUMN "sourceProfileUrl" TEXT;

-- Old backfill and automatic agent-reply values meant "someone answered the
-- chat", not "a salesperson completed a phone call".
UPDATE "social_conversations"
SET
  "customerStage" = 'marketing_contacted',
  "customerStageReason" = CASE
    WHEN "customerStageSource" = 'backfill'
      THEN 'Mesaj tarixçəsində marketinq əməkdaşının cavabı var.'
    ELSE 'Marketinq əməkdaşı Inbox-da cavab göndərib.'
  END,
  "customerStageUpdatedAt" = CURRENT_TIMESTAMP
WHERE "customerStage" = 'sales_contacted'
  AND (
    "customerStageSource" = 'backfill'
    OR "customerStageReason" IN ('Agent sent a reply', 'Marketing agent sent an inbox reply')
  );

UPDATE "inbox_customer_stage_events"
SET
  "toStage" = 'marketing_contacted',
  "reason" = CASE
    WHEN "source" = 'backfill'
      THEN 'Mesaj tarixçəsində marketinq əməkdaşının cavabı var.'
    ELSE 'Marketinq əməkdaşı Inbox-da cavab göndərib.'
  END
WHERE "toStage" = 'sales_contacted'
  AND (
    "source" = 'backfill'
    OR "reason" IN ('Agent sent a reply', 'Marketing agent sent an inbox reply')
  );

-- Existing model/backfill classifications become suggestions. The current
-- business state is left empty until a human confirms it in the Lead.
UPDATE "tasks" AS task
SET "customFields" = COALESCE(task."customFields", '{}'::jsonb) - 'inboxCustomerStatus'
FROM "social_conversations" AS conversation
WHERE conversation."metadata"->>'qualificationTaskId' = task."id"
  AND conversation."organizationId" = task."organizationId"
  AND conversation."customerStageSource" IN ('ai', 'backfill')
  AND conversation."customerStage" IN ('interested', 'potential', 'no_result');

UPDATE "social_conversations"
SET
  "aiSuggestedCustomerStage" = COALESCE("aiSuggestedCustomerStage", "customerStage"),
  "aiCustomerStageConfidence" = COALESCE("aiCustomerStageConfidence", "customerStageConfidence"),
  "aiCustomerStageReason" = COALESCE("aiCustomerStageReason", "customerStageReason"),
  "aiCustomerStageSuggestedAt" = COALESCE("aiCustomerStageSuggestedAt", "customerStageUpdatedAt", CURRENT_TIMESTAMP),
  "customerStage" = NULL,
  "customerStageSource" = NULL,
  "customerStageConfidence" = NULL,
  "customerStageReason" = NULL,
  "customerStageUpdatedAt" = NULL,
  "customerStageUpdatedBy" = NULL
WHERE "customerStageSource" IN ('ai', 'backfill')
  AND "customerStage" IN ('interested', 'potential', 'no_result');

UPDATE "tasks" AS task
SET "customFields" = jsonb_set(
  COALESCE(task."customFields", '{}'::jsonb),
  '{inboxCustomerStatus}',
  '"Marketinq əlaqə saxladı"'::jsonb,
  true
)
WHERE task."organizationId" IS NOT NULL
  AND task."customFields"->>'inboxCustomerStatus' = 'Satış əlaqə saxladı'
  AND EXISTS (
    SELECT 1
    FROM "social_conversations" AS conversation
    WHERE conversation."organizationId" = task."organizationId"
      AND conversation."metadata"->>'qualificationTaskId' = task."id"
      AND conversation."customerStage" = 'marketing_contacted'
  );

UPDATE "custom_fields"
SET "options" = ARRAY[
  'Maraqlanan izləyici',
  'Potensial izləyici',
  'Marketinq əlaqə saxladı',
  'Satış əlaqə saxladı',
  'Satış əlaqə saxlaya bilmədi',
  'Satıldı',
  'Satılmadı',
  'Nəticəsiz'
]::TEXT[]
WHERE "entityType" = 'task'
  AND "fieldName" = 'inboxCustomerStatus';

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_customer_stage_check"
  CHECK (
    "customerStage" IS NULL OR "customerStage" IN (
      'sales_contacted',
      'interested',
      'potential',
      'unable_to_contact',
      'sold',
      'not_sold',
      'no_result'
    )
  );

CREATE INDEX "leads_organizationId_customerStage_idx"
  ON "leads"("organizationId", "customerStage");

ALTER TABLE "social_conversations"
  ADD CONSTRAINT "social_conversations_customer_stage_check"
  CHECK (
    "customerStage" IS NULL OR "customerStage" IN (
      'interested',
      'potential',
      'marketing_contacted',
      'sales_contacted',
      'unable_to_contact',
      'sold',
      'not_sold',
      'no_result'
    )
  ),
  ADD CONSTRAINT "social_conversations_customer_stage_source_check"
  CHECK (
    "customerStageSource" IS NULL OR
    "customerStageSource" IN ('agent', 'lead', 'ai', 'system', 'backfill')
  );

ALTER TABLE "inbox_customer_stage_events"
  ADD CONSTRAINT "inbox_customer_stage_events_stage_check"
  CHECK (
    "toStage" IN (
      'interested',
      'potential',
      'marketing_contacted',
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
        'marketing_contacted',
        'sales_contacted',
        'unable_to_contact',
        'sold',
        'not_sold',
        'no_result'
      )
    )
  ),
  ADD CONSTRAINT "inbox_customer_stage_events_source_check"
  CHECK ("source" IN ('agent', 'lead', 'ai', 'system', 'backfill'));
