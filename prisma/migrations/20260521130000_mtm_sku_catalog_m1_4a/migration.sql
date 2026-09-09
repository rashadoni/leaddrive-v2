-- M1-4a Mars Overseas pilot — SKU catalog core (categories + SKUs +
-- warehouses + stock). Phase 2 will add MtmSkuPrice, MtmPromotion +
-- MtmPromotionSku + MtmCreditLimit + MtmOrderItem refactor.
--
-- Additive — no existing table touched. All four new tables are
-- per-org with cascade-on-Organization-delete (tenant cleanup); the
-- intra-catalog FK choices reflect "deleting a category shouldn't
-- delete its SKUs (set null)" vs "deleting a SKU should delete its
-- stock rows (cascade)" semantics.

CREATE TABLE "mtm_sku_categories" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentId"       TEXT,
  "name"           TEXT NOT NULL,
  "nameAz"         TEXT,
  "nameEn"         TEXT,
  "code"           TEXT,
  "iconUrl"        TEXT,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_sku_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mtm_sku_categories_organizationId_code_key"
  ON "mtm_sku_categories"("organizationId", "code");
CREATE INDEX "mtm_sku_categories_organizationId_idx" ON "mtm_sku_categories"("organizationId");
CREATE INDEX "mtm_sku_categories_parentId_idx" ON "mtm_sku_categories"("parentId");

CREATE TABLE "mtm_skus" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "categoryId"     TEXT,
  "code"           TEXT NOT NULL,
  "externalId"     TEXT,
  "barcode"        TEXT,
  "name"           TEXT NOT NULL,
  "nameAz"         TEXT,
  "nameEn"         TEXT,
  "description"    TEXT,
  "brand"          TEXT,
  "unit"           TEXT NOT NULL DEFAULT 'шт',
  "packSize"       INTEGER NOT NULL DEFAULT 1,
  "basePrice"      DECIMAL(10, 2) NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'AZN',
  "imageUrl"       TEXT,
  "thumbnailUrl"   TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "weight"         DOUBLE PRECISION,
  "volumeMl"       INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_skus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mtm_skus_organizationId_code_key"
  ON "mtm_skus"("organizationId", "code");
CREATE INDEX "mtm_skus_organizationId_idx" ON "mtm_skus"("organizationId");
CREATE INDEX "mtm_skus_categoryId_idx" ON "mtm_skus"("categoryId");
CREATE INDEX "mtm_skus_brand_idx" ON "mtm_skus"("brand");

CREATE TABLE "mtm_warehouses" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "address"        TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_warehouses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mtm_warehouses_organizationId_code_key"
  ON "mtm_warehouses"("organizationId", "code");
CREATE INDEX "mtm_warehouses_organizationId_idx" ON "mtm_warehouses"("organizationId");

CREATE TABLE "mtm_sku_stocks" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "skuId"          TEXT NOT NULL,
  "warehouseId"    TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL DEFAULT 0,
  "reservedQty"    INTEGER NOT NULL DEFAULT 0,
  "lastSyncedAt"   TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_sku_stocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mtm_sku_stocks_skuId_warehouseId_key"
  ON "mtm_sku_stocks"("skuId", "warehouseId");
CREATE INDEX "mtm_sku_stocks_organizationId_idx" ON "mtm_sku_stocks"("organizationId");
CREATE INDEX "mtm_sku_stocks_warehouseId_idx" ON "mtm_sku_stocks"("warehouseId");

-- FKs
ALTER TABLE "mtm_sku_categories"
  ADD CONSTRAINT "mtm_sku_categories_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_sku_categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "mtm_sku_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mtm_skus"
  ADD CONSTRAINT "mtm_skus_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_skus_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "mtm_sku_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mtm_warehouses"
  ADD CONSTRAINT "mtm_warehouses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_sku_stocks"
  ADD CONSTRAINT "mtm_sku_stocks_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_sku_stocks_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "mtm_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mtm_sku_stocks_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "mtm_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
