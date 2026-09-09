-- F-41 cross-tenant guard performance indices.
--
-- The hot path is `src/app/api/v1/uploads/[...path]/route.ts:179,196`:
--   • mtm-photos: SELECT … FROM mtm_photos WHERE organizationId = $1 AND url = $2
--   • contracts:  SELECT … FROM contract_files WHERE organizationId = $1 AND fileName = $2
--
-- Without composite indices these become org-filtered scans for every
-- /uploads/* request. Admin gallery pages can fan out to 30-50 image
-- requests per load; this turns those into 30-50 sequential filters.
-- The composite indices give the planner index-only access.
--
-- For contract_files the constraint is UNIQUE (matches the upload
-- route's 32-char-hex uniqueness assumption — collisions are
-- astronomical but now enforced). For mtm_photos it's a plain index
-- because the `url` column can theoretically repeat across re-uploads.
--
-- Architect P2 from review of e9683f92.

-- ContractFile: composite unique on (organizationId, fileName)
ALTER TABLE "contract_files"
  ADD CONSTRAINT "contract_files_organizationId_fileName_key"
  UNIQUE ("organizationId", "fileName");

-- MtmPhoto: composite index on (organizationId, url)
CREATE INDEX "mtm_photos_organizationId_url_idx"
  ON "mtm_photos"("organizationId", "url");
