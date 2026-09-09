-- Migration: 20260524210000_d5_d8_float_to_decimal
--
-- D5 Payments slice-2 P0 blocker + D8 Loyalty TODO(D5-decimal) co-migration.
--
-- Converts IEEE-754 Float money columns to NUMERIC(18,4) and rate/multiplier
-- columns to NUMERIC(6,4) to eliminate rounding drift (0.1+0.2 ≠ 0.3).
--
-- Columns migrated:
--   payment_intents.amount             Float  → NUMERIC(18,4)
--   payment_refunds.amount             Float  → NUMERIC(18,4)
--   loyalty_tiers.multiplier           Float  → NUMERIC(6,4)
--   loyalty_earn_rules."pointsRate"    Float  → NUMERIC(18,4)
--   loyalty_earn_rules."minOrderAmount" Float → NUMERIC(18,4)
--
-- NOTE: loyalty_earn_rules columns are camelCase in the DB (no @map in schema).
--       Postgres column names are case-sensitive; quotes required.
--
-- Safe because:
--   • USING clause casts existing Float values; loss of precision beyond 4dp
--     is acceptable (money amounts in practice have ≤ 4 decimal places).
--   • Columns are nullable ("pointsRate", "minOrderAmount") or have application-
--     level defaults (amount required at write time, never NULL).
--   • No FK targets these columns — only table-local constraint CHECK lives at
--     application layer.
--   • Run inside a transaction; Postgres will validate NUMERIC(18,4) cast before
--     committing — any out-of-range value (>14 integer digits) will error clearly.

-- D5: PaymentIntent.amount
ALTER TABLE "payment_intents"
  ALTER COLUMN "amount" TYPE NUMERIC(18,4) USING "amount"::NUMERIC(18,4);

-- D5: PaymentRefund.amount
ALTER TABLE "payment_refunds"
  ALTER COLUMN "amount" TYPE NUMERIC(18,4) USING "amount"::NUMERIC(18,4);

-- D8: LoyaltyTier.multiplier
ALTER TABLE "loyalty_tiers"
  ALTER COLUMN "multiplier" TYPE NUMERIC(6,4) USING "multiplier"::NUMERIC(6,4);

-- D8: LoyaltyEarnRule.pointsRate (camelCase column name in DB — must be quoted)
ALTER TABLE "loyalty_earn_rules"
  ALTER COLUMN "pointsRate" TYPE NUMERIC(18,4) USING "pointsRate"::NUMERIC(18,4);

-- D8: LoyaltyEarnRule.minOrderAmount (camelCase column name in DB — must be quoted)
ALTER TABLE "loyalty_earn_rules"
  ALTER COLUMN "minOrderAmount" TYPE NUMERIC(18,4) USING "minOrderAmount"::NUMERIC(18,4);
