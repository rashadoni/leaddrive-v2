-- CDP Calculated Insights — daily KPI snapshot table for trend / sparkline.
--
-- One row per org per day, written by POST /api/cron/customer-insights-snapshot
-- (capturedBy NULL = cron). The 4 headline KPIs mirror the
-- /api/v1/calculated-insights aggregates (shared computeOrgInsights) so each
-- KPI card's trend stays consistent with its live value. Purely additive — no
-- historical backfill; sparklines fill in as daily snapshots accumulate.

CREATE TABLE "customer_insights_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalProfiles" INTEGER NOT NULL DEFAULT 0,
    "highRiskCount" INTEGER NOT NULL DEFAULT 0,
    "avgEngagement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dominantLtv" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "dominantCurrency" TEXT NOT NULL DEFAULT 'AZN',
    "capturedBy" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_insights_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_insights_snapshots_organizationId_snapshotDate_idx" ON "customer_insights_snapshots"("organizationId", "snapshotDate");

ALTER TABLE "customer_insights_snapshots" ADD CONSTRAINT "customer_insights_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
