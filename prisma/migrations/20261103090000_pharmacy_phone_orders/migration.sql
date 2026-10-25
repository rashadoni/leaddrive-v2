-- Phone orders: the list a pharmacy dictated to the AI operator, kept for a
-- manager to check and enter into 1C. Both tables are tenant data under the
-- usual FORCE row-level security; the lines carry their own organizationId.
CREATE TABLE "pharmacy_phone_orders" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "providerCallId" TEXT NOT NULL,
  "callStartedAt" TIMESTAMP(3) NOT NULL,
  "callerPhone" TEXT NOT NULL,
  "pharmacyIdentification" TEXT NOT NULL,
  "pharmacyGuid" TEXT,
  "pharmacyName" TEXT,
  "pharmacyAddress" TEXT,
  "catalogSource" TEXT NOT NULL,
  "catalogScopeKey" TEXT NOT NULL,
  "catalogVersion" TEXT NOT NULL,
  "catalogObservedAt" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AZN',
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectReason" TEXT,
  "managerNotice" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pharmacy_phone_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pharmacy_phone_orders_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pharmacy_phone_orders_number_check" CHECK ("number" > 0),
  CONSTRAINT "pharmacy_phone_orders_status_check" CHECK ("status" IN ('pending_review', 'confirmed', 'rejected')),
  CONSTRAINT "pharmacy_phone_orders_identification_check"
    CHECK ("pharmacyIdentification" IN ('test_call', 'phone_unique', 'named_on_call', 'unidentified')),
  CONSTRAINT "pharmacy_phone_orders_total_check" CHECK ("totalAmount" >= 0),
  CONSTRAINT "pharmacy_phone_orders_confirmed_check" CHECK (("status" = 'confirmed') = ("confirmedAt" IS NOT NULL)),
  CONSTRAINT "pharmacy_phone_orders_rejected_check" CHECK (("status" = 'rejected') = ("rejectedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "pharmacy_phone_orders_organizationId_number_key" ON "pharmacy_phone_orders"("organizationId", "number");
CREATE UNIQUE INDEX "pharmacy_phone_orders_organizationId_providerCallId_key" ON "pharmacy_phone_orders"("organizationId", "providerCallId");
CREATE INDEX "pharmacy_phone_orders_organizationId_status_createdAt_idx" ON "pharmacy_phone_orders"("organizationId", "status", "createdAt");

CREATE TABLE "pharmacy_phone_order_lines" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "externalId" TEXT,
  "itemCode" TEXT,
  "productName" TEXT,
  "spokenText" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit" TEXT NOT NULL,
  "unitPrice" DECIMAL(12,4),
  "lineTotal" DECIMAL(14,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pharmacy_phone_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pharmacy_phone_order_lines_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pharmacy_phone_order_lines_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "pharmacy_phone_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pharmacy_phone_order_lines_status_check" CHECK ("status" IN ('resolved', 'not_found')),
  CONSTRAINT "pharmacy_phone_order_lines_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100000),
  CONSTRAINT "pharmacy_phone_order_lines_resolved_check"
    CHECK (("status" = 'resolved') = ("externalId" IS NOT NULL AND "productName" IS NOT NULL))
);
CREATE UNIQUE INDEX "pharmacy_phone_order_lines_orderId_position_key" ON "pharmacy_phone_order_lines"("orderId", "position");
CREATE INDEX "pharmacy_phone_order_lines_organizationId_idx" ON "pharmacy_phone_order_lines"("organizationId");

ALTER TABLE "pharmacy_phone_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_phone_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pharmacy_phone_orders"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "pharmacy_phone_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_phone_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pharmacy_phone_order_lines"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
