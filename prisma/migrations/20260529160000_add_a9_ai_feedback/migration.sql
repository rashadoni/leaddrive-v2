-- A9 Adaptive AI Models — slice-1.
--
-- User-supplied feedback on AI predictions. Slice-1 only ships data
-- layer + pure aggregation helper. Slice-2 wires API routes + UI
-- feedback widget on prediction surfaces. Slice-3 closes the adaptive
-- loop — accumulated feedback adjusts prediction confidence.
--
-- Polymorphism follows the established pattern (T9 HealthScore, M10
-- ContentScore): one shared table for all prediction surfaces beats
-- N sibling tables. `predictionTargetId` is intentionally string-only
-- (no FK) — type-aware lookup happens at the route layer so adding
-- new prediction taxonomy values doesn't require a schema migration.
-- CHECK list mirrored in `src/lib/adaptive-ai/types.ts`.

CREATE TABLE "ai_feedback" (
  "id"                 TEXT NOT NULL,
  "organizationId"     TEXT NOT NULL,
  "predictionType"     TEXT NOT NULL,
  "predictionTargetId" TEXT NOT NULL,
  "predictionValue"    TEXT,
  "rating"             INTEGER NOT NULL,
  "comment"            TEXT,
  "userId"             TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_feedback_prediction_type_chk"
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
  CONSTRAINT "ai_feedback_rating_range_chk"
    CHECK ("rating" IN (-1, 0, 1))
);

CREATE INDEX "ai_feedback_org_type_created_idx"
  ON "ai_feedback"("organizationId", "predictionType", "createdAt");

CREATE INDEX "ai_feedback_target_idx"
  ON "ai_feedback"("organizationId", "predictionType", "predictionTargetId");

ALTER TABLE "ai_feedback"
  ADD CONSTRAINT "ai_feedback_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
