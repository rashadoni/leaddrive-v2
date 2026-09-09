-- D8 Loyalty Phase E — Points expiry cron infrastructure.
--
-- Adds two columns to loyalty_transactions:
--   • expiresAt  — optional expiry timestamp set at earn time;
--                  null = points never expire.
--   • expiredAt  — set by the cron when it processes this earn row
--                  for expiry; null = not yet expired.
--
-- Only earn rows will have expiresAt populated; all other types
-- must leave both columns NULL (enforced by application layer;
-- adding a DB CHECK would need the type column which complicates
-- partial-index expressions and is defended by route logic).
--
-- The partial index speeds up the daily cron sweep that queries
-- earn rows with expiresAt < now() AND expiredAt IS NULL.

ALTER TABLE "loyalty_transactions"
  ADD COLUMN "expiresAt"  TIMESTAMPTZ,
  ADD COLUMN "expiredAt"  TIMESTAMPTZ;

-- Partial index: only cover earn rows that have a non-null expiry and
-- haven't been processed yet. The WHERE clause keeps the index small
-- (it grows only as un-expired earn rows accumulate) and targets the
-- exact predicate used in the cron query.
CREATE INDEX "loyalty_transactions_expiry_sweep_idx"
  ON "loyalty_transactions"("organizationId", "expiresAt")
  WHERE "type" = 'earn' AND "expiredAt" IS NULL AND "expiresAt" IS NOT NULL;
