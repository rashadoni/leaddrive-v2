-- Add CPQ line-item type + SKU (additive, nullable/defaulted — no backfill)
ALTER TABLE "products" ADD COLUMN "sku" TEXT;
ALTER TABLE "products" ADD COLUMN "productType" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "quote_line_items" ADD COLUMN "sku" TEXT;
ALTER TABLE "quote_line_items" ADD COLUMN "productType" TEXT NOT NULL DEFAULT 'other';
