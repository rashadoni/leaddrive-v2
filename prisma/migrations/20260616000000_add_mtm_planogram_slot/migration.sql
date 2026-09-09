-- Shelf-AI golden-reference: per-product slot on a planogram's "golden"
-- reference shelf photo. The supervisor authors these (mark each product on the
-- ideal shelf); a field scan then compares against them per-slot to produce
-- compliance. Additive — no existing table touched, no data rewritten.
--
-- `embedding` is for the future deterministic embedding-match path; the live
-- Claude-comparison detector does not use it (Prisma Float[] -> empty-array
-- default, same convention as RecordEmbedding).

-- CreateTable
CREATE TABLE "mtm_planogram_slots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planogramId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "skuId" TEXT,
    "label" TEXT NOT NULL,
    "bbox" JSONB NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "refCropUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_planogram_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mtm_planogram_slots_planogramId_slotIndex_key" ON "mtm_planogram_slots"("planogramId", "slotIndex");

-- CreateIndex
CREATE INDEX "mtm_planogram_slots_organizationId_idx" ON "mtm_planogram_slots"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_planogram_slots_planogramId_idx" ON "mtm_planogram_slots"("planogramId");

-- AddForeignKey
ALTER TABLE "mtm_planogram_slots" ADD CONSTRAINT "mtm_planogram_slots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_planogram_slots" ADD CONSTRAINT "mtm_planogram_slots_planogramId_fkey" FOREIGN KEY ("planogramId") REFERENCES "mtm_planograms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
