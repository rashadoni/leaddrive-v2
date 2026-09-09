-- R4 Consumer Goods Cloud (Phase 5 slice 1).
-- TPM + Retail Execution layered onto MTM.

CREATE TABLE "trade_promotions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "productSkus" TEXT[],
    "channelType" TEXT,
    "budgetAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budgetCurrency" TEXT NOT NULL DEFAULT 'USD',
    "upliftTargetAmount" DOUBLE PRECISION,
    "baselineSalesAmount" DOUBLE PRECISION,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trade_promotions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "trade_promotions"
  ADD CONSTRAINT "trade_promotions_status_check"
  CHECK ("status" IN ('planned', 'active', 'completed', 'cancelled'));

ALTER TABLE "trade_promotions"
  ADD CONSTRAINT "trade_promotions_dates_check"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "trade_promotions"
  ADD CONSTRAINT "trade_promotions_budget_check"
  CHECK ("budgetAmount" >= 0);

CREATE UNIQUE INDEX "trade_promotions_org_name_uniq"
  ON "trade_promotions"("organizationId", "name");

CREATE INDEX "trade_promotions_org_status_idx"
  ON "trade_promotions"("organizationId", "status");

CREATE INDEX "trade_promotions_org_dates_idx"
  ON "trade_promotions"("organizationId", "startsAt", "endsAt");

ALTER TABLE "trade_promotions"
  ADD CONSTRAINT "trade_promotions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "promotion_tactics" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "expectedUpliftPct" DOUBLE PRECISION,
    "allocatedBudgetAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotion_tactics_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "promotion_tactics"
  ADD CONSTRAINT "promotion_tactics_kind_check"
  CHECK ("kind" IN ('discount', 'display', 'sample', 'coupon', 'bundle'));

ALTER TABLE "promotion_tactics"
  ADD CONSTRAINT "promotion_tactics_budget_check"
  CHECK ("allocatedBudgetAmount" >= 0);

CREATE INDEX "promotion_tactics_promotion_idx" ON "promotion_tactics"("promotionId");

ALTER TABLE "promotion_tactics"
  ADD CONSTRAINT "promotion_tactics_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "trade_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "trade_spends" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "tacticId" TEXT NOT NULL,
    "customerId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "attributedSalesAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_spends_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "trade_spends"
  ADD CONSTRAINT "trade_spends_amount_check"
  CHECK ("amount" >= 0);

CREATE INDEX "trade_spends_org_promotion_idx" ON "trade_spends"("organizationId", "promotionId");
CREATE INDEX "trade_spends_tactic_idx" ON "trade_spends"("tacticId");
CREATE INDEX "trade_spends_recordedAt_idx" ON "trade_spends"("recordedAt");

ALTER TABLE "trade_spends"
  ADD CONSTRAINT "trade_spends_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_spends"
  ADD CONSTRAINT "trade_spends_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "trade_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trade_spends"
  ADD CONSTRAINT "trade_spends_tacticId_fkey"
  FOREIGN KEY ("tacticId") REFERENCES "promotion_tactics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "retail_execution_audits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT,
    "visitId" TEXT NOT NULL,
    "planogramSpec" JSONB NOT NULL,
    "observations" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "auditedBy" TEXT,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retail_execution_audits_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "retail_execution_audits"
  ADD CONSTRAINT "retail_execution_audits_totalScore_check"
  CHECK ("totalScore" >= 0 AND "totalScore" <= 100);

CREATE INDEX "retail_execution_audits_org_audited_idx"
  ON "retail_execution_audits"("organizationId", "auditedAt");
CREATE INDEX "retail_execution_audits_visit_idx" ON "retail_execution_audits"("visitId");
CREATE INDEX "retail_execution_audits_promotion_idx" ON "retail_execution_audits"("promotionId");

ALTER TABLE "retail_execution_audits"
  ADD CONSTRAINT "retail_execution_audits_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "retail_execution_audits"
  ADD CONSTRAINT "retail_execution_audits_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "trade_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- visitId is a CASCADE FK into mtm_visits — audit lives with its
-- visit. Deleting a visit deletes its audits (matches the JSDoc on
-- RetailExecutionAudit). Slice 2 may revisit this if a separate
-- durable audit-log retention requirement emerges, but for slice 1
-- the audit is conceptually visit-scoped data.
ALTER TABLE "retail_execution_audits"
  ADD CONSTRAINT "retail_execution_audits_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
