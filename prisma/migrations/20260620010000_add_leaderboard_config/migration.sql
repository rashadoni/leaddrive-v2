-- KPI Arena (Phase C): per-org configurable KPI weights + status thresholds.
-- 1:1 per org. No row = loader defaults (today's hardcoded constants), so this is
-- a pure no-op until an admin saves overrides. Additive, no backfill.
CREATE TABLE "leaderboard_config" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mtmWeights" JSONB NOT NULL DEFAULT '{}',
    "statusThresholds" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leaderboard_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "leaderboard_config_org_uniq" ON "leaderboard_config"("organizationId");
