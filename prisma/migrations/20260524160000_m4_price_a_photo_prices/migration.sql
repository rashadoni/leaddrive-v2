-- M4-PRICE-a: MtmPhotoPrice — OCR price tag records from shelf photos
-- One photo can have multiple price tags.  Each row links back to the photo
-- and optionally to the nearest detected SKU (by bbox spatial proximity).
-- rawOcrText stores the raw Google Vision output for audit purposes.
-- priceValue uses DECIMAL(10,2) for exact currency arithmetic (AZN).
-- isPromo flags struck-through prices (promotional pricing).
--
-- Fully idempotent:
--   - CREATE TABLE IF NOT EXISTS (safe on rerun)
--   - FK constraints wrapped in DO-blocks (skip if constraint already exists)
--   - CREATE INDEX IF NOT EXISTS (safe on rerun)
--   - _prisma_migrations self-register uses WHERE NOT EXISTS guard

CREATE TABLE IF NOT EXISTS "mtm_photo_prices" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "photoId"        TEXT         NOT NULL,
  "skuId"          TEXT,
  "bbox"           JSONB        NOT NULL,
  "rawOcrText"     TEXT         NOT NULL,
  "ocrConfidence"  DOUBLE PRECISION NOT NULL,
  "priceValue"     DECIMAL(10, 2) NOT NULL,
  "currency"       TEXT         NOT NULL DEFAULT 'AZN',
  "isPromo"        BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_photo_prices_pkey" PRIMARY KEY ("id")
);

-- Foreign keys — each wrapped in a DO-block so the script is safe to replay.
-- ON UPDATE CASCADE: matches the existing MTM FK convention (see mtm_shelf_analyses,
-- mtm_skus, mtm_planograms) — id columns are cuid PKs never updated in practice.
DO $$ BEGIN
  ALTER TABLE "mtm_photo_prices"
    ADD CONSTRAINT "mtm_photo_prices_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "mtm_photo_prices"
    ADD CONSTRAINT "mtm_photo_prices_photoId_fkey"
      FOREIGN KEY ("photoId") REFERENCES "mtm_photos"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "mtm_photo_prices"
    ADD CONSTRAINT "mtm_photo_prices_skuId_fkey"
      FOREIGN KEY ("skuId") REFERENCES "mtm_skus"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes (spec §13: @@index([organizationId]), @@index([photoId]), @@index([skuId]))
CREATE INDEX IF NOT EXISTS "mtm_photo_prices_organizationId_idx"
  ON "mtm_photo_prices"("organizationId");

CREATE INDEX IF NOT EXISTS "mtm_photo_prices_photoId_idx"
  ON "mtm_photo_prices"("photoId");

CREATE INDEX IF NOT EXISTS "mtm_photo_prices_skuId_idx"
  ON "mtm_photo_prices"("skuId");

-- Register migration in _prisma_migrations so prisma migrate deploy skips it
-- (same idempotent-on-rerun pattern used for 20260522140000_m3_3a_planograms)
INSERT INTO "_prisma_migrations" (
  id, checksum, finished_at, migration_name, logs, rolled_back_at,
  started_at, applied_steps_count
)
SELECT
  gen_random_uuid()::text,
  'manually-applied',
  NOW(),
  '20260524160000_m4_price_a_photo_prices',
  NULL,
  NULL,
  NOW(),
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260524160000_m4_price_a_photo_prices'
);
