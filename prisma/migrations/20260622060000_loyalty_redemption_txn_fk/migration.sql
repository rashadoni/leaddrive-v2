-- [P3] LoyaltyRedemption.transactionId → LoyaltyTransaction FK (onDelete SET NULL).
-- Makes the fulfilment-record ↔ debit-txn link referentially sound. SET NULL so
-- deleting or expiring a transaction nulls the link rather than cascading the
-- redemption away. Additive — the column already exists and is always set to a
-- freshly-created 'redeem' txn on redeem, so there are no orphan values to clean.
ALTER TABLE "loyalty_redemptions"
  ADD CONSTRAINT "loyalty_redemptions_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "loyalty_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
