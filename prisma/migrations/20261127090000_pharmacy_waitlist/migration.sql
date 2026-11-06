-- A product a pharmacy wanted on the line while it was sold out (owner's
-- client, 2026-11-06). One row per call and product; see schema.prisma
-- PharmacyWaitlistItem.
CREATE TABLE "pharmacy_waitlist_items" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "orderId" TEXT,
  "providerCallId" TEXT NOT NULL,
  "companyId" TEXT,
  "pharmacyGuid" TEXT,
  "pharmacyName" TEXT,
  "catalogScopeKey" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "spokenText" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "arrivedAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pharmacy_waitlist_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pharmacy_waitlist_items_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pharmacy_waitlist_items_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "pharmacy_phone_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pharmacy_waitlist_items_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pharmacy_waitlist_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100000),
  CONSTRAINT "pharmacy_waitlist_items_dismissed_check" CHECK (("dismissedAt" IS NULL) OR ("dismissedById" IS NOT NULL))
);
CREATE UNIQUE INDEX "pharmacy_waitlist_items_organizationId_providerCallId_externalId_key"
  ON "pharmacy_waitlist_items"("organizationId", "providerCallId", "externalId");
CREATE INDEX "pharmacy_waitlist_items_organizationId_catalogScopeKey_arrivedAt_idx"
  ON "pharmacy_waitlist_items"("organizationId", "catalogScopeKey", "arrivedAt");
CREATE INDEX "pharmacy_waitlist_items_organizationId_companyId_idx"
  ON "pharmacy_waitlist_items"("organizationId", "companyId");

ALTER TABLE "pharmacy_waitlist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_waitlist_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pharmacy_waitlist_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
