-- Strict compliance mode (per-planogram toggle): deviation in BOTH directions
-- (including overstock) lowers the score. Default false keeps the lenient
-- overstock-tolerant scoring for all existing planograms.

-- AlterTable
ALTER TABLE "mtm_planograms" ADD COLUMN "strictCompliance" BOOLEAN NOT NULL DEFAULT false;
