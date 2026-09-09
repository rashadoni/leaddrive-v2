-- D3 OMS — Order Shipment + Return / RMA (Phase 6 Block A slice 1).
-- Builds on D1 BuyerOrder to add the post-submission fulfillment + RMA
-- lifecycle that's shared between B2B (direct BuyerOrder.create) and
-- B2C (Cart → CheckoutSession.completed → BuyerOrder).
--
-- Slice 1 ships schema + pure helpers (state machines, quantity-cap
-- validator, BuyerOrder → Invoice projection). Slice 2 wires the
-- shipping-provider integrations, RMA admin UI, refund webhooks.

CREATE TABLE "order_shipments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastStatusNote" TEXT,
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_shipments"
  ADD CONSTRAINT "order_shipments_status_check"
  CHECK ("status" IN ('pending', 'in_transit', 'delivered', 'exception', 'cancelled'));

-- shippedAt + deliveredAt must align with status:
--   • status='pending' / 'cancelled'  → shippedAt IS NULL, deliveredAt IS NULL
--   • status='in_transit' / 'exception' → shippedAt IS NOT NULL, deliveredAt IS NULL
--   • status='delivered' → BOTH timestamps NOT NULL AND shippedAt ≤ deliveredAt
-- This prevents bad data like a 'delivered' shipment with no shippedAt,
-- which would otherwise corrupt SLA / fulfillment-time reports.
ALTER TABLE "order_shipments"
  ADD CONSTRAINT "order_shipments_timestamps_check"
  CHECK (
    (("status" IN ('pending', 'cancelled')) AND "shippedAt" IS NULL AND "deliveredAt" IS NULL)
    OR (("status" IN ('in_transit', 'exception')) AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NULL)
    OR (("status" = 'delivered') AND "shippedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "shippedAt" <= "deliveredAt")
  );

CREATE INDEX "order_shipments_org_status_idx" ON "order_shipments"("organizationId", "status");
CREATE INDEX "order_shipments_order_created_idx" ON "order_shipments"("orderId", "createdAt");
CREATE INDEX "order_shipments_tracking_idx" ON "order_shipments"("trackingNumber");

ALTER TABLE "order_shipments"
  ADD CONSTRAINT "order_shipments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_shipments"
  ADD CONSTRAINT "order_shipments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "buyer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "order_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rmaNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "refundedAmount" DOUBLE PRECISION,
    "refundRef" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_returns"
  ADD CONSTRAINT "order_returns_status_check"
  CHECK ("status" IN ('requested', 'approved', 'received', 'refunded', 'closed', 'rejected', 'cancelled'));

-- Refund amount must be non-negative when set. The helper enforces the
-- per-line ≤ original-line-total cap (cross-order math the DB can't do
-- in a single CHECK without a trigger).
ALTER TABLE "order_returns"
  ADD CONSTRAINT "order_returns_refund_amount_check"
  CHECK ("refundedAmount" IS NULL OR "refundedAmount" >= 0);

-- Refund-state invariant: refundedAmount + refundRef + refundedAt all
-- coexist (set together at the same transition). Either ALL three are
-- NULL (pre-refund states) or NONE are NULL (refunded / closed).
ALTER TABLE "order_returns"
  ADD CONSTRAINT "order_returns_refund_coherence_check"
  CHECK (
    ("refundedAmount" IS NULL AND "refundRef" IS NULL AND "refundedAt" IS NULL)
    OR ("refundedAmount" IS NOT NULL AND "refundRef" IS NOT NULL AND "refundedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "order_returns_org_rma_uniq" ON "order_returns"("organizationId", "rmaNumber");
CREATE INDEX "order_returns_org_status_idx" ON "order_returns"("organizationId", "status");
CREATE INDEX "order_returns_order_created_idx" ON "order_returns"("orderId", "createdAt");

ALTER TABLE "order_returns"
  ADD CONSTRAINT "order_returns_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_returns"
  ADD CONSTRAINT "order_returns_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "buyer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "order_return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "refundAmount" DOUBLE PRECISION,
    CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_return_items"
  ADD CONSTRAINT "order_return_items_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "order_return_items"
  ADD CONSTRAINT "order_return_items_refund_amount_check"
  CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0);

-- Per (return, original-line) uniqueness: prevents a single return from
-- listing the same order line twice. Cross-return cumulative-cap math
-- happens in the helper (validateReturnQuantities) because it needs to
-- sum across siblings, not in one row.
CREATE UNIQUE INDEX "order_return_items_return_orderitem_uniq"
  ON "order_return_items"("returnId", "orderItemId");
CREATE INDEX "order_return_items_return_idx" ON "order_return_items"("returnId");
CREATE INDEX "order_return_items_order_item_idx" ON "order_return_items"("orderItemId");

ALTER TABLE "order_return_items"
  ADD CONSTRAINT "order_return_items_returnId_fkey"
  FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_return_items"
  ADD CONSTRAINT "order_return_items_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "buyer_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
