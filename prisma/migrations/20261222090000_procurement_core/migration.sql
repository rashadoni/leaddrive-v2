-- Procurement for a customer order (docs/sales-procurement/README.md, stage 3):
-- purchase requests raised from a deal, supplier quotes, purchase orders with an
-- approval chain by amount, their status history. Every table is a tenant table
-- under FORCE ROW LEVEL SECURITY, like the rest of the CRM.

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "neededBy" TIMESTAMP(3),
    "note" TEXT,
    "requestedById" TEXT,
    "assignedToId" TEXT,
    "dealChangedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "dealLineItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "status" TEXT NOT NULL DEFAULT 'received',
    "validUntil" TIMESTAMP(3),
    "leadTimeDays" INTEGER,
    "terms" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quote_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "leadTimeDays" INTEGER,
    "note" TEXT,

    CONSTRAINT "supplier_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "requestId" TEXT,
    "dealId" TEXT,
    "supplierId" TEXT NOT NULL,
    "quoteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "expectedDeliveryAt" TIMESTAMP(3),
    "overdueAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "dealChangedAt" TIMESTAMP(3),
    "note" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "dealLineItemId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "receivedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_approval_steps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "approverRole" TEXT,
    "approverUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actedById" TEXT,
    "actedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requests_organizationId_status_idx" ON "purchase_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "purchase_requests_organizationId_dealId_idx" ON "purchase_requests"("organizationId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_organizationId_seq_key" ON "purchase_requests"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "purchase_request_items_organizationId_requestId_idx" ON "purchase_request_items"("organizationId", "requestId");

-- CreateIndex
CREATE INDEX "supplier_quotes_organizationId_requestId_idx" ON "supplier_quotes"("organizationId", "requestId");

-- CreateIndex
CREATE INDEX "supplier_quotes_organizationId_supplierId_idx" ON "supplier_quotes"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_quote_items_organizationId_quoteId_idx" ON "supplier_quote_items"("organizationId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quote_items_quoteId_requestItemId_key" ON "supplier_quote_items"("quoteId", "requestItemId");

-- CreateIndex
CREATE INDEX "purchase_orders_organizationId_status_idx" ON "purchase_orders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_organizationId_dealId_idx" ON "purchase_orders"("organizationId", "dealId");

-- CreateIndex
CREATE INDEX "purchase_orders_organizationId_supplierId_idx" ON "purchase_orders"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_organizationId_seq_key" ON "purchase_orders"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "purchase_order_items_organizationId_orderId_idx" ON "purchase_order_items"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "purchase_order_approval_steps_organizationId_status_idx" ON "purchase_order_approval_steps"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_approval_steps_orderId_revision_stepNo_key" ON "purchase_order_approval_steps"("orderId", "revision", "stepNo");

-- CreateIndex
CREATE INDEX "purchase_order_events_organizationId_orderId_createdAt_idx" ON "purchase_order_events"("organizationId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_dealLineItemId_fkey" FOREIGN KEY ("dealLineItemId") REFERENCES "deal_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "purchase_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "supplier_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "purchase_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_dealLineItemId_fkey" FOREIGN KEY ("dealLineItemId") REFERENCES "deal_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approval_steps" ADD CONSTRAINT "purchase_order_approval_steps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approval_steps" ADD CONSTRAINT "purchase_order_approval_steps_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_events" ADD CONSTRAINT "purchase_order_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_events" ADD CONSTRAINT "purchase_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Closed vocabularies, so no writer can invent a status the screens do not know.
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'in_progress', 'ordered', 'closed', 'cancelled'));
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_status_check"
  CHECK ("status" IN ('received', 'selected', 'rejected'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check"
  CHECK ("status" IN ('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'in_production', 'in_transit', 'partially_received', 'received', 'cancelled'));
ALTER TABLE "purchase_order_approval_steps" ADD CONSTRAINT "purchase_order_approval_steps_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'skipped'));
ALTER TABLE "purchase_order_approval_steps" ADD CONSTRAINT "purchase_order_approval_steps_approver_check"
  CHECK ("approverRole" IS NOT NULL OR "approverUserId" IS NOT NULL);
-- Money and quantities are never negative; a received quantity never exceeds the ordered one.
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_amounts_check" CHECK ("quantity" > 0 AND "unitPrice" >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_check" CHECK ("totalAmount" >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_amounts_check"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "total" >= 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity");

ALTER TABLE "purchase_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_requests"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "purchase_request_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_request_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_request_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "supplier_quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_quotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_quotes"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "supplier_quote_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_quote_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_quote_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_orders"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_items"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "purchase_order_approval_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_approval_steps" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_approval_steps"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "purchase_order_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_events"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

