-- D1 B2B Commerce (Phase 6 Block A slice 1).

CREATE TABLE "buyer_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "priceListId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "buyer_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "buyer_accounts"
  ADD CONSTRAINT "buyer_accounts_status_check"
  CHECK ("status" IN ('active', 'suspended', 'closed'));

ALTER TABLE "buyer_accounts"
  ADD CONSTRAINT "buyer_accounts_credit_check"
  CHECK ("creditLimit" >= 0);

ALTER TABLE "buyer_accounts"
  ADD CONSTRAINT "buyer_accounts_paymentTerms_check"
  CHECK ("paymentTermsDays" >= 0 AND "paymentTermsDays" <= 365);

CREATE UNIQUE INDEX "buyer_accounts_org_company_uniq" ON "buyer_accounts"("organizationId", "companyId");
CREATE INDEX "buyer_accounts_org_status_idx" ON "buyer_accounts"("organizationId", "status");

ALTER TABLE "buyer_accounts"
  ADD CONSTRAINT "buyer_accounts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "buyer_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerAccountId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requestedDeliveryAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "buyer_orders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'approved', 'shipped', 'delivered', 'closed', 'cancelled', 'rejected'));

ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_total_check"
  CHECK ("totalAmount" >= 0);

CREATE UNIQUE INDEX "buyer_orders_org_number_uniq" ON "buyer_orders"("organizationId", "orderNumber");
CREATE INDEX "buyer_orders_org_status_idx" ON "buyer_orders"("organizationId", "status");
CREATE INDEX "buyer_orders_account_created_idx" ON "buyer_orders"("buyerAccountId", "createdAt");

ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "buyer_orders"
  ADD CONSTRAINT "buyer_orders_buyerAccountId_fkey"
  FOREIGN KEY ("buyerAccountId") REFERENCES "buyer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "buyer_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "buyer_order_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "buyer_order_items"
  ADD CONSTRAINT "buyer_order_items_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "buyer_order_items"
  ADD CONSTRAINT "buyer_order_items_unitPrice_check"
  CHECK ("unitPrice" >= 0);

ALTER TABLE "buyer_order_items"
  ADD CONSTRAINT "buyer_order_items_discount_check"
  CHECK ("discountPct" >= 0 AND "discountPct" <= 100);

ALTER TABLE "buyer_order_items"
  ADD CONSTRAINT "buyer_order_items_totalPrice_check"
  CHECK ("totalPrice" >= 0);

CREATE INDEX "buyer_order_items_order_idx" ON "buyer_order_items"("orderId");
CREATE INDEX "buyer_order_items_product_idx" ON "buyer_order_items"("productId");

ALTER TABLE "buyer_order_items"
  ADD CONSTRAINT "buyer_order_items_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "buyer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "request_for_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerAccountId" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validUntil" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "request_for_quotes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "request_for_quotes"
  ADD CONSTRAINT "request_for_quotes_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'quoted', 'accepted', 'rejected', 'expired'));

CREATE UNIQUE INDEX "request_for_quotes_org_number_uniq" ON "request_for_quotes"("organizationId", "rfqNumber");
CREATE INDEX "request_for_quotes_org_status_idx" ON "request_for_quotes"("organizationId", "status");
CREATE INDEX "request_for_quotes_account_created_idx" ON "request_for_quotes"("buyerAccountId", "createdAt");

ALTER TABLE "request_for_quotes"
  ADD CONSTRAINT "request_for_quotes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "request_for_quotes"
  ADD CONSTRAINT "request_for_quotes_buyerAccountId_fkey"
  FOREIGN KEY ("buyerAccountId") REFERENCES "buyer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "request_for_quote_items" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "requestedUnitPrice" DOUBLE PRECISION,
    "quotedUnitPrice" DOUBLE PRECISION,
    CONSTRAINT "request_for_quote_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "request_for_quote_items"
  ADD CONSTRAINT "request_for_quote_items_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "request_for_quote_items"
  ADD CONSTRAINT "request_for_quote_items_prices_check"
  CHECK (("requestedUnitPrice" IS NULL OR "requestedUnitPrice" >= 0)
     AND ("quotedUnitPrice" IS NULL OR "quotedUnitPrice" >= 0));

CREATE INDEX "request_for_quote_items_rfq_idx" ON "request_for_quote_items"("rfqId");

ALTER TABLE "request_for_quote_items"
  ADD CONSTRAINT "request_for_quote_items_rfqId_fkey"
  FOREIGN KEY ("rfqId") REFERENCES "request_for_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
