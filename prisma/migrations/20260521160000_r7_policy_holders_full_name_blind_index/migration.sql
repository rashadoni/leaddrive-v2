-- R7 Policy-Holders — blind-index column for exact-match search on
-- the encrypted fullName column. Mirrors migrations
-- 20260521140000 (citizens) + 20260521150000 (health_patients).
-- Online-safe; no backfill.

ALTER TABLE "policy_holders"
  ADD COLUMN "fullNameBlindIndex" TEXT;

CREATE INDEX "policy_holders_org_full_name_blind_idx"
  ON "policy_holders" ("organizationId", "fullNameBlindIndex");
