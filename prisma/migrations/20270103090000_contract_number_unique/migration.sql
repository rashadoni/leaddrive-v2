-- A contract number is one contract in an organization (owner 2026-11-26, «Опасные места»).
-- Until now nothing stopped two: the intake numbered by count + 1 (a deleted contract freed a
-- number that was still taken), the wizard by the clock to the second, and a person could type any.
-- Checked read-only on production 2026-11-27: 63 contracts, no number repeated, none empty — so the
-- index builds. Should one appear before this deploys, the migration fails before cutover and the
-- release stops with production untouched.
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_org_number_uniq" ON "contracts"("organizationId", "contractNumber");
