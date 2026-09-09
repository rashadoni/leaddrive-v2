-- Migration: mtm-promotions (M2-2a)
-- Adds: MtmPromotionType enum, MtmPromotion, MtmPromotionSku, MtmCreditLimit models
-- Updates: MtmSku (promotions relation), MtmWarehouse (orders relation),
--          MtmOrder (warehouseId, subtotal, discountAmount, taxAmount, currency, appliedPromotions, pdfUrl)
--          totalAmount type Float → Decimal

-- ── 1. Enum ──────────────────────────────────────────────────────────────────

CREATE TYPE "MtmPromotionType" AS ENUM (
  'PERCENT_DISCOUNT',
  'BULK_DISCOUNT',
  'BOGO',
  'GIFT'
);

-- ── 2. MtmPromotion ───────────────────────────────────────────────────────────

CREATE TABLE "mtm_promotions" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "type"             "MtmPromotionType" NOT NULL,
  "config"           JSONB NOT NULL DEFAULT '{}',
  "validFrom"        TIMESTAMP(3) NOT NULL,
  "validTo"          TIMESTAMP(3) NOT NULL,
  "customerCategory" "MtmCustomerCategory",
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mtm_promotions_organizationId_idx" ON "mtm_promotions"("organizationId");
CREATE INDEX "mtm_promotions_validFrom_validTo_idx" ON "mtm_promotions"("validFrom", "validTo");

ALTER TABLE "mtm_promotions"
  ADD CONSTRAINT "mtm_promotions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. MtmPromotionSku ────────────────────────────────────────────────────────

CREATE TABLE "mtm_promotion_skus" (
  "promotionId" TEXT NOT NULL,
  "skuId"       TEXT NOT NULL,

  CONSTRAINT "mtm_promotion_skus_pkey" PRIMARY KEY ("promotionId", "skuId")
);

CREATE INDEX "mtm_promotion_skus_skuId_idx" ON "mtm_promotion_skus"("skuId");

ALTER TABLE "mtm_promotion_skus"
  ADD CONSTRAINT "mtm_promotion_skus_promotionId_fkey"
  FOREIGN KEY ("promotionId") REFERENCES "mtm_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_promotion_skus"
  ADD CONSTRAINT "mtm_promotion_skus_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "mtm_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. MtmCreditLimit ─────────────────────────────────────────────────────────

CREATE TABLE "mtm_credit_limits" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId"     TEXT NOT NULL,
  "limitAmount"    DECIMAL(12, 2) NOT NULL,
  "currentDebt"    DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "currency"       TEXT NOT NULL DEFAULT 'AZN',
  "daysOverdue"    INTEGER NOT NULL DEFAULT 0,
  "isBlocked"      BOOLEAN NOT NULL DEFAULT false,
  "lastSyncedAt"   TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_credit_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_credit_limits_customerId_key" ON "mtm_credit_limits"("customerId");
CREATE INDEX "mtm_credit_limits_organizationId_idx" ON "mtm_credit_limits"("organizationId");

ALTER TABLE "mtm_credit_limits"
  ADD CONSTRAINT "mtm_credit_limits_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_credit_limits"
  ADD CONSTRAINT "mtm_credit_limits_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "mtm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. MtmOrder — new columns + type change for totalAmount ──────────────────

-- Add new columns (nullable first, then set defaults)
ALTER TABLE "mtm_orders"
  ADD COLUMN IF NOT EXISTS "warehouseId"        TEXT,
  ADD COLUMN IF NOT EXISTS "subtotal"           DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount"     DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxAmount"          DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency"           TEXT NOT NULL DEFAULT 'AZN',
  ADD COLUMN IF NOT EXISTS "appliedPromotions"  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "pdfUrl"             TEXT;

-- Migrate totalAmount from Float → Decimal (rename → convert → rename back)
ALTER TABLE "mtm_orders"
  ADD COLUMN IF NOT EXISTS "totalAmount_new" DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE "mtm_orders" SET "totalAmount_new" = ROUND(CAST("totalAmount" AS DECIMAL(12,2)), 2);

ALTER TABLE "mtm_orders" DROP COLUMN "totalAmount";
ALTER TABLE "mtm_orders" RENAME COLUMN "totalAmount_new" TO "totalAmount";

-- Foreign key for warehouseId
ALTER TABLE "mtm_orders"
  ADD CONSTRAINT "mtm_orders_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "mtm_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "mtm_orders_warehouseId_idx" ON "mtm_orders"("warehouseId");
