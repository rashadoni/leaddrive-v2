-- C9 #17 — AttributionModel.recomputeRequestedAt: dirty marker for the
-- incremental recompute-on-won drainer. Additive + nullable; existing models
-- start NULL (nothing pending) and the periodic full-sweep cron is unaffected.

ALTER TABLE "attribution_models" ADD COLUMN "recomputeRequestedAt" TIMESTAMP(3);

CREATE INDEX "attribution_models_recomputeRequestedAt_idx"
  ON "attribution_models"("recomputeRequestedAt");
