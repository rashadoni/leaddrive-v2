-- D8 Loyalty slice-2 item 5 — PromoCode money columns Float → Decimal(18,4)
--
-- Follow-on to 20260524210000_d5_d8_float_to_decimal which migrated D5 payment
-- amounts and the D8 LoyaltyTier.multiplier / LoyaltyEarnRule.pointsRate /
-- LoyaltyEarnRule.minOrderAmount. Those columns were included in the same PR as
-- D5. The PromoCode money columns were omitted from that batch and are closed
-- here as their own migration (same IEEE-754 drift class).
--
-- Columns migrated:
--   promo_codes."discountValue"           DOUBLE PRECISION → DECIMAL(18,4)
--   promo_codes."minOrderAmount"          DOUBLE PRECISION → DECIMAL(18,4)  (nullable)
--   promo_code_redemptions."discountApplied"  DOUBLE PRECISION → DECIMAL(18,4)
--
-- Safe because:
--   • USING clause casts existing Float values; precision beyond 4dp rounds
--     (money amounts in practice have ≤ 4 decimal places).
--   • DB CHECK constraints on promo_codes stay valid: NUMERIC arithmetic
--     under > 0 / <= 100 / >= 0 is unchanged — Postgres evaluates CHECK on
--     both old and new column types identically for these comparisons.
--   • No FK targets these money columns.
--   • discountApplied in promo_code_redemptions is append-only (no UPDATE
--     path exists in the app layer) — cast risk is write-path-only.

ALTER TABLE "promo_codes"
  ALTER COLUMN "discountValue" TYPE DECIMAL(18,4) USING "discountValue"::DECIMAL(18,4);

ALTER TABLE "promo_codes"
  ALTER COLUMN "minOrderAmount" TYPE DECIMAL(18,4) USING "minOrderAmount"::DECIMAL(18,4);

ALTER TABLE "promo_code_redemptions"
  ALTER COLUMN "discountApplied" TYPE DECIMAL(18,4) USING "discountApplied"::DECIMAL(18,4);
