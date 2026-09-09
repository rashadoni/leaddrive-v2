-- M1-2 Mars Overseas pilot — photo watermark + EXIF audit columns.
-- See docs/mtm-photo-watermark-spec.md §4 (backend validation) and
-- src/lib/mtm-audit.ts (PHOTO_TAMPER_DETECTED constant).
--
-- Atomic and additive — no existing column is altered, no data is
-- rewritten. tamperingDetected defaults to false so historical rows
-- are treated as untampered until re-reviewed.

ALTER TABLE "mtm_photos"
  ADD COLUMN "exifData"          JSONB,
  ADD COLUMN "watermarkedAt"     TIMESTAMP(3),
  ADD COLUMN "gpsMatchedAt"      TIMESTAMP(3),
  ADD COLUMN "tamperingDetected" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "mtm_photos_tamperingDetected_idx" ON "mtm_photos"("tamperingDetected");
