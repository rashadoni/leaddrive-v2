-- Contract.valueAmount — Float? → Decimal(18,4)
-- Follow-on to A12 (20260524240000_a12_float_to_decimal).
-- IEEE-754 drift is significant for MRR division and contract revenue sums.

ALTER TABLE "contracts"
  ALTER COLUMN "valueAmount" TYPE DECIMAL(18,4) USING "valueAmount"::DECIMAL(18,4);
