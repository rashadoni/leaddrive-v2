-- Durable mobile visit-photo retries. A client-generated id is unique within
-- the authenticated agent scope; legacy web uploads keep NULL and are
-- unaffected because PostgreSQL permits multiple NULLs in a unique index.

ALTER TABLE "mtm_photos"
  ADD COLUMN "clientPhotoId" TEXT;

CREATE UNIQUE INDEX "mtm_photos_organizationId_agentId_clientPhotoId_key"
  ON "mtm_photos"("organizationId", "agentId", "clientPhotoId");
