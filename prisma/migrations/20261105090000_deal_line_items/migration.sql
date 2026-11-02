-- Product lines of a deal; the deal's amount is their sum when there are any.
CREATE TABLE "deal_line_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4),
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deal_line_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_line_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "deal_line_items_unitPrice_check" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0),
    CONSTRAINT "deal_line_items_discountPct_check" CHECK ("discountPct" >= 0 AND "discountPct" <= 100)
);
CREATE INDEX "deal_line_items_organizationId_dealId_idx" ON "deal_line_items"("organizationId", "dealId");
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deal_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_line_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_line_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
