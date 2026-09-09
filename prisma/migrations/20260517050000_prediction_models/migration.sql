-- H3 Einstein Prediction Builder (Phase 3 slice 1).
-- Per-tenant trained AutoML models + append-only prediction-run log.

CREATE TABLE "prediction_models" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objectType" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "positiveValues" TEXT[],
    "inputFields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "artifact" JSONB,
    "accuracy" DOUBLE PRECISION,
    "trainedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prediction_models_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "prediction_models"
  ADD CONSTRAINT "prediction_models_status_check"
  CHECK ("status" IN ('draft', 'training', 'trained', 'failed'));

ALTER TABLE "prediction_models"
  ADD CONSTRAINT "prediction_models_objectType_check"
  CHECK ("objectType" IN ('deal', 'lead', 'ticket'));

CREATE INDEX "prediction_models_organizationId_objectType_idx"
  ON "prediction_models"("organizationId", "objectType");

ALTER TABLE "prediction_models"
  ADD CONSTRAINT "prediction_models_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "prediction_runs" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "band" TEXT NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prediction_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "prediction_runs"
  ADD CONSTRAINT "prediction_runs_band_check"
  CHECK ("band" IN ('very_likely', 'likely', 'uncertain', 'unlikely', 'very_unlikely'));

ALTER TABLE "prediction_runs"
  ADD CONSTRAINT "prediction_runs_score_check"
  CHECK ("score" >= 0 AND "score" <= 1);

CREATE INDEX "prediction_runs_modelId_recordType_recordId_idx"
  ON "prediction_runs"("modelId", "recordType", "recordId");

CREATE INDEX "prediction_runs_organizationId_recordType_recordId_idx"
  ON "prediction_runs"("organizationId", "recordType", "recordId");

ALTER TABLE "prediction_runs"
  ADD CONSTRAINT "prediction_runs_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "prediction_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prediction_runs"
  ADD CONSTRAINT "prediction_runs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
