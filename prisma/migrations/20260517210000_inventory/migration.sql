-- D7: Inventory Management (Phase 6 Block A).
-- Salesforce Inventory Cloud analogue. Tracks per-warehouse stock
-- (`InventoryItem`), an append-only `StockMovement` audit trail of
-- every in/out, and per-item `LowStockAlert` rows the cron emits so
-- the same threshold isn't re-alerted on every poll.
--
-- Slice 1 ships schema + pure helpers (movement-validator,
-- available-quantity calculator, reservation engine, low-stock
-- detector) + admin warehouse + inventory-item routes. Slice 2 wires
-- StockMovement POSTs, reservation hooks for B2C/B2B carts (D1/D2),
-- and the low-stock alert cron. Slice 3 wires the multi-warehouse
-- transfer flow + per-tenant alert thresholds + Slack/email
-- notification dispatch.

-- ── Warehouse ───────────────────────────────────────────────────
-- Physical or logical inventory location. A tenant may have N
-- warehouses; one warehouse = one InventoryItem row per Product.
-- `code` is human-readable (e.g. "WH-NYC-01") + unique per tenant
-- for cross-system reference (ERP, shipping label, etc.).
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- code regex matches the operational convention: uppercase alnum +
-- hyphens, 2-32 chars, must start with a letter. Forbids spaces,
-- lowercase, punctuation — keeps shipping-label generation simple.
ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_code_check"
  CHECK ("code" ~ '^[A-Z][A-Z0-9-]{1,31}$');

CREATE UNIQUE INDEX "warehouses_org_code_uniq" ON "warehouses"("organizationId", "code");
CREATE INDEX "warehouses_org_active_idx" ON "warehouses"("organizationId", "isActive");

ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── InventoryItem ───────────────────────────────────────────────
-- Per-(warehouse, product) stock. UNIQUE on (warehouseId, productId)
-- so a single warehouse cannot have two rows for the same SKU. Stock
-- math is split into `quantityOnHand` (physical count) and
-- `quantityReserved` (allocated to open carts/orders); the public
-- "available" is `onHand - reserved`, computed by the helper. Both
-- fields are non-negative (CHECK), and `reserved <= onHand` is
-- enforced so we never promise stock we don't have.
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    /** Threshold below which the low-stock-detector raises an alert. NULL = no per-item override; use tenant default. */
    "lowStockThreshold" INTEGER,
    /** Human-readable SKU snapshot for cross-system reference (separate from Product.id). */
    "sku" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_on_hand_check"
  CHECK ("quantityOnHand" >= 0);

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_reserved_check"
  CHECK ("quantityReserved" >= 0);

-- The promise-what-you-have invariant. A row where reserved > onHand
-- means we've allocated stock we don't physically have — slice-2
-- reservation route MUST cap-check before write; this CHECK is the
-- backstop.
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_reserved_le_on_hand_check"
  CHECK ("quantityReserved" <= "quantityOnHand");

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_low_stock_threshold_check"
  CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

CREATE UNIQUE INDEX "inventory_items_warehouse_product_uniq" ON "inventory_items"("warehouseId", "productId");
CREATE INDEX "inventory_items_org_warehouse_idx" ON "inventory_items"("organizationId", "warehouseId");
CREATE INDEX "inventory_items_product_idx" ON "inventory_items"("productId");

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Product FK uses RESTRICT — deleting a Product with extant
-- inventory rows is blocked at the DB level; the operator must
-- explicitly zero out + delete the inventory item first. Prevents
-- accidental product-delete from orphaning stock numbers.
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── StockMovement ───────────────────────────────────────────────
-- Append-only audit. Every change to InventoryItem.quantityOnHand or
-- quantityReserved emits one row. `quantityDelta` is SIGNED: positive
-- for receipts/release, negative for shipments/reservations/loss.
-- `type` describes the business reason; `quantityDelta` sign MUST
-- match per the helper's `movement-validator`.
--
-- `referenceId` is an opaque app-level FK — for cart reservations
-- it's the Cart.id, for B2B order shipments it's the BuyerOrder.id,
-- for adjustments it's null. The validator helper consumes the type
-- to know what referenceId shape to expect.
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    /** Business-reason enum — see CHECK below. */
    "type" TEXT NOT NULL,
    /**
     * Signed quantity delta:
     *   receipt / release / transfer_in / adjustment_in → positive
     *   shipment / reservation / loss / transfer_out / adjustment_out → negative
     * NEVER zero — movements that have no effect are a no-op and
     * must not produce audit rows.
     */
    "quantityDelta" INTEGER NOT NULL,
    /**
     * Which inventory column moved:
     *   "onHand"   — physical receipt / shipment / adjustment / loss
     *   "reserved" — cart reservation / release
     */
    "column" TEXT NOT NULL,
    "reason" TEXT,
    /** Optional app-level reference (Cart.id / BuyerOrder.id / etc.). */
    "referenceId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_type_check"
  CHECK ("type" IN (
    'receipt', 'shipment', 'reservation', 'release',
    'transfer_in', 'transfer_out',
    'adjustment_in', 'adjustment_out', 'loss'
  ));

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_column_check"
  CHECK ("column" IN ('onHand', 'reserved'));

-- A zero delta is meaningless audit noise — forbid.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_delta_nonzero_check"
  CHECK ("quantityDelta" <> 0);

-- Sign-vs-type coherence: positive deltas only for inbound types,
-- negative only for outbound. The helper enforces this too, but the
-- CHECK is the backstop against raw-SQL writes.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_sign_check"
  CHECK (
    (("type" IN ('receipt', 'release', 'transfer_in', 'adjustment_in')) AND "quantityDelta" > 0)
    OR (("type" IN ('shipment', 'reservation', 'transfer_out', 'adjustment_out', 'loss')) AND "quantityDelta" < 0)
  );

CREATE INDEX "stock_movements_org_created_idx" ON "stock_movements"("organizationId", "createdAt");
CREATE INDEX "stock_movements_item_created_idx" ON "stock_movements"("inventoryItemId", "createdAt");
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements"("referenceId");

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── LowStockAlert ───────────────────────────────────────────────
-- One row per (inventoryItemId, triggeredAt) — the slice-2 cron polls
-- inventory_items where availableQty <= threshold AND NOT EXISTS an
-- unresolved alert, then inserts an alert + dispatches notification.
-- Closed via `resolvedAt`; "acknowledged but unresolved" via
-- `acknowledgedAt` (operator saw it but stock not yet replenished).
CREATE TABLE "low_stock_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    /** Threshold at the moment the alert fired — snapshot so a later threshold change doesn't retro-mutate history. */
    "thresholdAtTrigger" INTEGER NOT NULL,
    /** Available qty (onHand - reserved) at trigger time. */
    "availableAtTrigger" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "low_stock_alerts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "low_stock_alerts"
  ADD CONSTRAINT "low_stock_alerts_threshold_check"
  CHECK ("thresholdAtTrigger" >= 0);

ALTER TABLE "low_stock_alerts"
  ADD CONSTRAINT "low_stock_alerts_available_check"
  CHECK ("availableAtTrigger" >= 0);

-- ack-coherence: acknowledgedBy iff acknowledgedAt — operator/timestamp pair
-- is set together at the same UPDATE.
ALTER TABLE "low_stock_alerts"
  ADD CONSTRAINT "low_stock_alerts_ack_coherence_check"
  CHECK (
    ("acknowledgedAt" IS NULL AND "acknowledgedBy" IS NULL)
    OR ("acknowledgedAt" IS NOT NULL AND "acknowledgedBy" IS NOT NULL)
  );

-- Idempotency: the slice-2 cron uses (inventoryItemId, resolvedAt IS NULL)
-- as the dedupe key. A partial UNIQUE on (inventoryItemId) WHERE
-- resolvedAt IS NULL enforces "at most one open alert per item" at
-- the DB level — cron crashes / double-fires can't create dup alerts.
CREATE UNIQUE INDEX "low_stock_alerts_item_open_uniq"
  ON "low_stock_alerts"("inventoryItemId")
  WHERE "resolvedAt" IS NULL;

CREATE INDEX "low_stock_alerts_org_triggered_idx" ON "low_stock_alerts"("organizationId", "triggeredAt");
CREATE INDEX "low_stock_alerts_item_triggered_idx" ON "low_stock_alerts"("inventoryItemId", "triggeredAt");

ALTER TABLE "low_stock_alerts"
  ADD CONSTRAINT "low_stock_alerts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "low_stock_alerts"
  ADD CONSTRAINT "low_stock_alerts_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
