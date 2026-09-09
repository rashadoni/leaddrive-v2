-- MTM Excel exchange: stable external keys, immutable validation snapshots,
-- and normalized plan rows used by plan-vs-fact reporting.

ALTER TABLE "mtm_agents" ADD COLUMN "externalCode" TEXT;
ALTER TABLE "mtm_routes" ADD COLUMN "externalId" TEXT;
ALTER TABLE "mtm_customers" ADD COLUMN "territoryCode" TEXT;

ALTER TABLE "mtm_import_jobs"
  ADD COLUMN "detectedSheet" TEXT,
  ADD COLUMN "headerMap" JSONB,
  ADD COLUMN "previewData" JSONB,
  ADD COLUMN "validatedSnapshot" JSONB,
  ADD COLUMN "validationSummary" JSONB;

CREATE UNIQUE INDEX "mtm_agents_organizationId_externalCode_key"
  ON "mtm_agents"("organizationId", "externalCode");
CREATE UNIQUE INDEX "mtm_routes_organizationId_externalId_key"
  ON "mtm_routes"("organizationId", "externalId");
CREATE INDEX "mtm_customers_organizationId_territoryCode_idx"
  ON "mtm_customers"("organizationId", "territoryCode");

CREATE TABLE "mtm_sales_plan_lines" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "customerId" TEXT,
  "agentId" TEXT,
  "territoryCode" TEXT,
  "productCode" TEXT,
  "plannedQuantity" DECIMAL(18,4),
  "plannedAmount" DECIMAL(18,4),
  "currency" TEXT NOT NULL DEFAULT 'AZN',
  "sourceImportJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_sales_plan_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_sales_plan_values_check" CHECK (
    ("plannedQuantity" IS NULL OR "plannedQuantity" >= 0) AND
    ("plannedAmount" IS NULL OR "plannedAmount" >= 0) AND
    ("plannedQuantity" IS NOT NULL OR "plannedAmount" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "mtm_sales_plan_lines_organizationId_dedupeKey_key"
  ON "mtm_sales_plan_lines"("organizationId", "dedupeKey");
CREATE INDEX "mtm_sales_plan_lines_organizationId_periodStart_idx"
  ON "mtm_sales_plan_lines"("organizationId", "periodStart");
CREATE INDEX "mtm_sales_plan_lines_organizationId_customerId_periodStart_idx"
  ON "mtm_sales_plan_lines"("organizationId", "customerId", "periodStart");
CREATE INDEX "mtm_sales_plan_lines_organizationId_agentId_periodStart_idx"
  ON "mtm_sales_plan_lines"("organizationId", "agentId", "periodStart");
CREATE INDEX "mtm_sales_plan_lines_sourceImportJobId_idx"
  ON "mtm_sales_plan_lines"("sourceImportJobId");

ALTER TABLE "mtm_sales_plan_lines" ADD CONSTRAINT "mtm_sales_plan_lines_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mtm_sales_plan_lines" ADD CONSTRAINT "mtm_sales_plan_lines_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_sales_plan_lines" ADD CONSTRAINT "mtm_sales_plan_lines_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mtm_sales_plan_lines" ADD CONSTRAINT "mtm_sales_plan_lines_sourceImportJobId_fkey"
  FOREIGN KEY ("sourceImportJobId") REFERENCES "mtm_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mtm_sales_plan_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_sales_plan_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_sales_plan_lines_tenant_isolation" ON "mtm_sales_plan_lines"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
