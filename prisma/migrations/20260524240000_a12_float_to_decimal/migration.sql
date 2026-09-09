-- A12 Revenue Intelligence — Float → Decimal(18,4) migration
-- Migrates 13 money columns that were incorrectly typed as IEEE-754 Float.
-- All columns carry deal amounts, forecast amounts, or accuracy-report variances
-- which require fixed-precision arithmetic. Prisma maps Decimal(18,4) → NUMERIC(18,4).
--
-- Tables:
--   deals                    — valueAmount
--   forecast_snapshots       — committedAmount, bestCaseAmount, forecastAmount
--   pipeline_stage_transitions — fromAmount, toAmount
--   forecast_accuracy_reports  — 7 amount/variance columns

-- deals.valueAmount
ALTER TABLE "deals"
  ALTER COLUMN "valueAmount" TYPE DECIMAL(18,4) USING "valueAmount"::DECIMAL(18,4);

-- forecast_snapshots
ALTER TABLE "forecast_snapshots"
  ALTER COLUMN "committedAmount" TYPE DECIMAL(18,4) USING "committedAmount"::DECIMAL(18,4),
  ALTER COLUMN "bestCaseAmount"  TYPE DECIMAL(18,4) USING "bestCaseAmount"::DECIMAL(18,4),
  ALTER COLUMN "forecastAmount"  TYPE DECIMAL(18,4) USING "forecastAmount"::DECIMAL(18,4);

-- pipeline_stage_transitions
ALTER TABLE "pipeline_stage_transitions"
  ALTER COLUMN "fromAmount" TYPE DECIMAL(18,4) USING "fromAmount"::DECIMAL(18,4),
  ALTER COLUMN "toAmount"   TYPE DECIMAL(18,4) USING "toAmount"::DECIMAL(18,4);

-- forecast_accuracy_reports
ALTER TABLE "forecast_accuracy_reports"
  ALTER COLUMN "actualAmount"         TYPE DECIMAL(18,4) USING "actualAmount"::DECIMAL(18,4),
  ALTER COLUMN "forecastedAmount"     TYPE DECIMAL(18,4) USING "forecastedAmount"::DECIMAL(18,4),
  ALTER COLUMN "committedAmount"      TYPE DECIMAL(18,4) USING "committedAmount"::DECIMAL(18,4),
  ALTER COLUMN "bestCaseAmount"       TYPE DECIMAL(18,4) USING "bestCaseAmount"::DECIMAL(18,4),
  ALTER COLUMN "varianceAbsForecast"  TYPE DECIMAL(18,4) USING "varianceAbsForecast"::DECIMAL(18,4),
  ALTER COLUMN "varianceAbsCommitted" TYPE DECIMAL(18,4) USING "varianceAbsCommitted"::DECIMAL(18,4),
  ALTER COLUMN "varianceAbsBestCase"  TYPE DECIMAL(18,4) USING "varianceAbsBestCase"::DECIMAL(18,4);
