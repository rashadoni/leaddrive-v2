-- G004: brand × cluster planograms — tag each planogram with the brand whose
-- merchandising standard it encodes. Additive + nullable → safe, no backfill.
ALTER TABLE "mtm_planograms" ADD COLUMN "brand" TEXT;

-- Brand-filtered planogram lists (a brand's standards across stores).
CREATE INDEX "mtm_planograms_organizationId_brand_idx" ON "mtm_planograms"("organizationId", "brand");
