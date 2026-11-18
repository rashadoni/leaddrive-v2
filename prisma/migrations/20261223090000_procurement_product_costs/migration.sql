-- Purchase price, unit and planned cost (docs/sales-procurement/README.md, task 2.2).
-- The purchase price lives in its own table so that no reader of "products"
-- (catalog, storefront, quotes, AI) ever carries it.

-- AlterTable
ALTER TABLE "products" ADD COLUMN "unit" TEXT;

-- AlterTable
ALTER TABLE "deal_line_items" ADD COLUMN "plannedUnitCost" DECIMAL(18,4);

-- CreateTable
CREATE TABLE "product_costs" (
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchasePrice" DECIMAL(18,4),
    "currency" TEXT NOT NULL,
    "defaultSupplierId" TEXT,
    "leadTimeDays" INTEGER,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_costs_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "product_costs_organizationId_idx" ON "product_costs"("organizationId");

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_money_check"
  CHECK (("purchasePrice" IS NULL OR "purchasePrice" >= 0) AND ("leadTimeDays" IS NULL OR "leadTimeDays" BETWEEN 0 AND 3650));
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_planned_unit_cost_check"
  CHECK ("plannedUnitCost" IS NULL OR "plannedUnitCost" >= 0);

ALTER TABLE "product_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_costs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_costs"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
