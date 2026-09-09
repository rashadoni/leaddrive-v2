-- M3-3a: Planogram models for shelf compliance
-- MtmPlanogram: stores expected SKU layout per customer category.
-- MtmShelfAnalysis gets a planogramId FK so compliance can be computed per photo.
-- Note: table may already exist if schema was previously applied via db push.

CREATE TABLE IF NOT EXISTS "mtm_planograms" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"    TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "customerCategory"  TEXT,
  "referenceImageUrl" TEXT,
  "expectedSkus"      JSONB NOT NULL DEFAULT '[]',
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_planograms_pkey" PRIMARY KEY ("id")
);

-- FK → organizations (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mtm_planograms_organizationId_fkey'
  ) THEN
    ALTER TABLE "mtm_planograms"
      ADD CONSTRAINT "mtm_planograms_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "mtm_planograms_organizationId_idx" ON "mtm_planograms"("organizationId");

-- Add planogramId FK to shelf analyses (nullable)
ALTER TABLE "mtm_shelf_analyses" ADD COLUMN IF NOT EXISTS "planogramId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mtm_shelf_analyses_planogramId_fkey'
  ) THEN
    ALTER TABLE "mtm_shelf_analyses"
      ADD CONSTRAINT "mtm_shelf_analyses_planogramId_fkey"
      FOREIGN KEY ("planogramId") REFERENCES "mtm_planograms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
