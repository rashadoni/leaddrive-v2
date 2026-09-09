-- A sales call can confirm several compatible facts at once, for example
-- "sales contacted" + "potential customer". Keep customerStage as the primary
-- compatibility value while storing the complete report in an array.

ALTER TABLE "leads"
  ADD COLUMN "salesCallOutcomes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "social_conversations"
  ADD COLUMN "salesCallOutcomes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "leads"
SET "salesCallOutcomes" = ARRAY["customerStage"]::TEXT[]
WHERE "customerStage" IS NOT NULL;

UPDATE "social_conversations"
SET "salesCallOutcomes" = ARRAY["customerStage"]::TEXT[]
WHERE "customerStageSource" = 'lead'
  AND "customerStage" IS NOT NULL;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_sales_call_outcomes_check"
  CHECK (
    "salesCallOutcomes" <@ ARRAY[
      'sales_contacted',
      'interested',
      'potential',
      'unable_to_contact',
      'sold',
      'not_sold',
      'no_result'
    ]::TEXT[]
    AND NOT (
      "salesCallOutcomes" @> ARRAY['sales_contacted']::TEXT[]
      AND "salesCallOutcomes" @> ARRAY['unable_to_contact']::TEXT[]
    )
    AND NOT (
      ("salesCallOutcomes" @> ARRAY['sold']::TEXT[] AND "salesCallOutcomes" @> ARRAY['not_sold']::TEXT[])
      OR ("salesCallOutcomes" @> ARRAY['sold']::TEXT[] AND "salesCallOutcomes" @> ARRAY['no_result']::TEXT[])
      OR ("salesCallOutcomes" @> ARRAY['not_sold']::TEXT[] AND "salesCallOutcomes" @> ARRAY['no_result']::TEXT[])
    )
  );

ALTER TABLE "social_conversations"
  ADD CONSTRAINT "social_conversations_sales_call_outcomes_check"
  CHECK (
    "salesCallOutcomes" <@ ARRAY[
      'sales_contacted',
      'interested',
      'potential',
      'unable_to_contact',
      'sold',
      'not_sold',
      'no_result'
    ]::TEXT[]
    AND NOT (
      "salesCallOutcomes" @> ARRAY['sales_contacted']::TEXT[]
      AND "salesCallOutcomes" @> ARRAY['unable_to_contact']::TEXT[]
    )
    AND NOT (
      ("salesCallOutcomes" @> ARRAY['sold']::TEXT[] AND "salesCallOutcomes" @> ARRAY['not_sold']::TEXT[])
      OR ("salesCallOutcomes" @> ARRAY['sold']::TEXT[] AND "salesCallOutcomes" @> ARRAY['no_result']::TEXT[])
      OR ("salesCallOutcomes" @> ARRAY['not_sold']::TEXT[] AND "salesCallOutcomes" @> ARRAY['no_result']::TEXT[])
    )
  );

CREATE INDEX "leads_organizationId_salesCallOutcomes_idx"
  ON "leads" USING GIN ("salesCallOutcomes");

CREATE INDEX "social_conversations_organizationId_salesCallOutcomes_idx"
  ON "social_conversations" USING GIN ("salesCallOutcomes");
