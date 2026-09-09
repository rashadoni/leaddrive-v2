-- Additive migration: partial unique index enforcing exactly ONE
-- isCanonicalSigned=true row per contract in contract_versions.
--
-- Prisma's schema DSL does not support partial unique indexes, so this
-- index is migration-only (matches the repo idiom established by
-- 20260521150000_mtm_soft_delete and others that use WHERE clauses).
--
-- No existing rows are at risk: isCanonicalSigned defaults to false and
-- a canonical version is only stamped at envelope completion (Slice 2
-- e-sign). On a fresh install there are zero true rows; on production
-- at most one per contract by app-layer invariant.

CREATE UNIQUE INDEX "contract_versions_one_canonical_per_contract"
  ON "contract_versions" ("contractId")
  WHERE "isCanonicalSigned";
