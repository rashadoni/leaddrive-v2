-- Durable Field media retry safety (server-first, additive).
--
-- Existing photo rows intentionally remain NULL: they were created before an
-- immutable byte digest existed and therefore cannot be proven to be an exact
-- replay. The API returns a visible idempotency conflict for a reused legacy
-- clientPhotoId rather than falsely acknowledging different local media.
-- No tenant data is rewritten and the existing FORCE RLS policy remains on
-- mtm_photos; adding a nullable column does not change its policy surface.

SET lock_timeout = '3s';

ALTER TABLE "mtm_photos"
  ADD COLUMN IF NOT EXISTS "checksumSha256" TEXT;
