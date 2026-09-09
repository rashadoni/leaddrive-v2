-- A9 Adaptive AI Models — slice-3.
--
-- Per-(org, predictionType) adjustment store. The slice-3 refresh
-- cron upserts a row here for each predictionType after aggregating
-- accumulated AiFeedback. Prediction engines read the current row at
-- request time and bias their output by `adjustmentFactor`.
--
-- adjustmentFactor / avgRating / approvalRate are Decimal(6,4) per
-- project policy (no Float for stored-and-compared values).
-- predictionType CHECK mirrors the AiFeedback CHECK + the
-- `src/lib/adaptive-ai/types.ts` enum-as-const list.

CREATE TABLE "ai_prediction_adjustments" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "predictionType"   TEXT NOT NULL,
  "adjustmentFactor" DECIMAL(6, 4) NOT NULL,
  "sampleSize"       INTEGER NOT NULL,
  "avgRating"        DECIMAL(6, 4) NOT NULL,
  "approvalRate"     DECIMAL(6, 4) NOT NULL,
  "lastComputedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_prediction_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_prediction_adjustment_prediction_type_chk"
    CHECK ("predictionType" IN (
      'prediction_deal_win',
      'prediction_churn',
      'prediction_lead_score',
      'prediction_revenue_forecast',
      'recommendation_next_action',
      'chat_response',
      'content_insight',
      'custom'
    )),
  CONSTRAINT "ai_prediction_adjustment_factor_range_chk"
    CHECK ("adjustmentFactor" >= -1 AND "adjustmentFactor" <= 1),
  CONSTRAINT "ai_prediction_adjustment_avg_rating_range_chk"
    CHECK ("avgRating" >= -1 AND "avgRating" <= 1),
  CONSTRAINT "ai_prediction_adjustment_approval_rate_range_chk"
    CHECK ("approvalRate" >= 0 AND "approvalRate" <= 1),
  CONSTRAINT "ai_prediction_adjustment_sample_size_chk"
    CHECK ("sampleSize" >= 0)
);

-- Composite uniqueness: one current adjustment row per
-- (organizationId, predictionType). The cron upserts on this key.
CREATE UNIQUE INDEX "ai_prediction_adjustment_org_type_unique"
  ON "ai_prediction_adjustments"("organizationId", "predictionType");

ALTER TABLE "ai_prediction_adjustments"
  ADD CONSTRAINT "ai_prediction_adjustments_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
