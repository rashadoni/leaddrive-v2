-- CreateEnum
CREATE TYPE "MtmAnnotationSource" AS ENUM ('MANUAL', 'AUTO', 'CONFIRMED');

-- CreateTable
CREATE TABLE "mtm_shelf_annotations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "bbox" JSONB NOT NULL,
    "source" "MtmAnnotationSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_shelf_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mtm_shelf_annotations_organizationId_idx" ON "mtm_shelf_annotations"("organizationId");

-- CreateIndex
CREATE INDEX "mtm_shelf_annotations_photoId_idx" ON "mtm_shelf_annotations"("photoId");

-- CreateIndex
CREATE INDEX "mtm_shelf_annotations_skuId_idx" ON "mtm_shelf_annotations"("skuId");

-- CreateIndex
CREATE INDEX "mtm_shelf_annotations_organizationId_source_idx" ON "mtm_shelf_annotations"("organizationId", "source");

-- AddForeignKey
ALTER TABLE "mtm_shelf_annotations" ADD CONSTRAINT "mtm_shelf_annotations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_shelf_annotations" ADD CONSTRAINT "mtm_shelf_annotations_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "mtm_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mtm_shelf_annotations" ADD CONSTRAINT "mtm_shelf_annotations_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "mtm_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
