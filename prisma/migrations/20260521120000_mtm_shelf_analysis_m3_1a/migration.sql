-- M3-1a Mars Overseas pilot — shelf-analysis pipeline tables.
-- See docs/mtm-image-recognition-spec.md §3 (Prisma schema) and
-- src/lib/queue/jobs/shelf-analysis.ts (worker handler).
--
-- Additive — no existing column touched, no data rewritten.

-- Status enum (PENDING/PROCESSING/COMPLETED/FAILED/REJECTED). REJECTED is
-- set by the M3-0 photo-quality pre-check that runs before Tier 1.
-- Sole-source — no idempotent guard needed (only created here).
CREATE TYPE "MtmShelfAnalysisStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REJECTED'
);

-- MtmCustomerCategory existed in earlier MTM migrations but the dev DB has
-- drift; guard so a fresh tenant install (where this is the first
-- migration that USES it as a column type) doesn't fail. Idempotent on
-- DBs that already have the enum.
DO $$ BEGIN
  CREATE TYPE "MtmCustomerCategory" AS ENUM ('A', 'B', 'C', 'D');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Planogram = "this is what shelf X should look like for category Y stores".
-- Used for compliance scoring on each analysis (M3-3).
CREATE TABLE "mtm_planograms" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "customerCategory"  "MtmCustomerCategory",
  "referenceImageUrl" TEXT,
  "expectedSkus"      JSONB NOT NULL,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_planograms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mtm_planograms_organizationId_idx" ON "mtm_planograms"("organizationId");

-- Shelf analysis = one row per photo that passes M3-0.
-- planogramId is auto-matched at analysis time by customer.category.
CREATE TABLE "mtm_shelf_analyses" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "photoId"          TEXT NOT NULL,
  "status"           "MtmShelfAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "provider"         TEXT NOT NULL,
  "detectedSkus"     JSONB NOT NULL,
  "totalFacings"     INTEGER NOT NULL DEFAULT 0,
  "shareOfShelf"     JSONB,
  "oosCount"         INTEGER NOT NULL DEFAULT 0,
  "oosList"          JSONB,
  "planogramId"      TEXT,
  "complianceScore"  DOUBLE PRECISION,
  "startedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "errorMessage"     TEXT,
  "costCents"        INTEGER,
  "modelVersion"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mtm_shelf_analyses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mtm_shelf_analyses_photoId_key" ON "mtm_shelf_analyses"("photoId");
CREATE INDEX "mtm_shelf_analyses_organizationId_idx" ON "mtm_shelf_analyses"("organizationId");
CREATE INDEX "mtm_shelf_analyses_status_idx" ON "mtm_shelf_analyses"("status");

-- FKs
ALTER TABLE "mtm_planograms"
  ADD CONSTRAINT "mtm_planograms_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_shelf_analyses"
  ADD CONSTRAINT "mtm_shelf_analyses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_shelf_analyses"
  ADD CONSTRAINT "mtm_shelf_analyses_photoId_fkey"
  FOREIGN KEY ("photoId") REFERENCES "mtm_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mtm_shelf_analyses"
  ADD CONSTRAINT "mtm_shelf_analyses_planogramId_fkey"
  FOREIGN KEY ("planogramId") REFERENCES "mtm_planograms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
