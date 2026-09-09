-- SWM-16B: every route mutation carries an optimistic-concurrency version.
-- Existing rows start at version 1. New publications record publishedVersion
-- atomically; already-published routes are backfilled below.
ALTER TABLE "mtm_routes"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "publishedVersion" INTEGER;

-- Preserve an explicit baseline for routes that were already published before
-- versioning was introduced. Drafts remain unpublished.
UPDATE "mtm_routes"
SET "publishedVersion" = "version"
WHERE "publishedAt" IS NOT NULL;
