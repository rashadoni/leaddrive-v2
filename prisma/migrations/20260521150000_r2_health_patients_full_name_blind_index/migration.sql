-- R2 Health-Patients — blind-index column for exact-match search on
-- the encrypted fullName column. Mirrors the citizens migration in
-- 20260521140000 — same shape, different table.
--
-- Online-safe: nullable column + no backfill. Old rows stay NULL
-- until a backfill cron walks them (separate slice-3 PR). New rows
-- post-merge get the index populated by the route's
-- `blindIndexForTenant()` call.
--
-- The index is tenant-scoped so the GET-list `?fullName=` filter
-- can use it without cross-tenant scans.

ALTER TABLE "health_patients"
  ADD COLUMN "fullNameBlindIndex" TEXT;

CREATE INDEX "health_patients_org_full_name_blind_idx"
  ON "health_patients" ("organizationId", "fullNameBlindIndex");
