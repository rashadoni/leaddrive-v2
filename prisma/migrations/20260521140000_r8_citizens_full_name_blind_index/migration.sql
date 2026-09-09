-- R8 Citizens — blind-index column for exact-match search on the
-- encrypted fullName column. Closes the slice-3 follow-up for
-- citizens (other entities — health_patients, policy_holders,
-- beneficiaries — follow the same shape in separate PRs).
--
-- Column is nullable + online-safe (no backfill in this migration).
-- New rows post-merge get the index populated by the route's
-- `blindIndexForTenant()` call. Old rows stay NULL until a backfill
-- cron walks them (separate slice-3 PR).
--
-- The index is tenant-scoped so the GET-list `?fullName=` filter
-- can use it without cross-tenant scans.

ALTER TABLE "citizens"
  ADD COLUMN "fullNameBlindIndex" TEXT;

CREATE INDEX "citizens_org_full_name_blind_idx"
  ON "citizens" ("organizationId", "fullNameBlindIndex");
