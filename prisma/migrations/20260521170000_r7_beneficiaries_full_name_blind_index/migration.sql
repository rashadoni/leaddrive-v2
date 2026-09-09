-- Slice-3 blind-index column on R7 beneficiaries.
--
-- Why: encryption hides `fullName` plaintext, which makes equality search
-- impossible. Blind-index stores HMAC-SHA256(per-tenant key,
-- normalize(fullName)) so the route layer can hash the query value and
-- look up matching rows without ever exposing plaintext.
--
-- Online-safe:
--   • Column is nullable — existing rows pass NULL until the backfill job
--     populates them. No table rewrite, no lock-table.
--   • Index is composite (organizationId, fullNameBlindIndex) — matches
--     the tenant-scoped equality filter pattern used by the listing
--     route. CREATE INDEX is non-CONCURRENTLY (Prisma migrations are
--     transactional; CONCURRENTLY can't run inside a tx). Acceptable on
--     a still-small table; slice-4 backfill PR will switch to
--     CONCURRENTLY if the table grows.

ALTER TABLE "beneficiaries" ADD COLUMN "fullNameBlindIndex" TEXT;

CREATE INDEX "beneficiaries_org_full_name_blind_idx"
  ON "beneficiaries" ("organizationId", "fullNameBlindIndex");
