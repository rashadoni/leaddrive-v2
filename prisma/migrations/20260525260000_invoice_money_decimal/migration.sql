-- Billing precision — Invoice money columns Float → Decimal(18,4)
-- D5 Payments closure (2026-05-25) unblocked this sweep.
-- IEEE-754 drift on repeated read-write cycles (billing totals, statements,
-- LTV rollups via calculated-insights) causes visible cent-level errors.
-- taxRate is intentionally left as DOUBLE PRECISION (it is a rate, not money).

ALTER TABLE "invoices"
  ALTER COLUMN "subtotal"       TYPE NUMERIC(18, 4) USING "subtotal"::NUMERIC(18, 4),
  ALTER COLUMN "discountValue"  TYPE NUMERIC(18, 4) USING "discountValue"::NUMERIC(18, 4),
  ALTER COLUMN "discountAmount" TYPE NUMERIC(18, 4) USING "discountAmount"::NUMERIC(18, 4),
  ALTER COLUMN "taxAmount"      TYPE NUMERIC(18, 4) USING "taxAmount"::NUMERIC(18, 4),
  ALTER COLUMN "totalAmount"    TYPE NUMERIC(18, 4) USING "totalAmount"::NUMERIC(18, 4),
  ALTER COLUMN "paidAmount"     TYPE NUMERIC(18, 4) USING "paidAmount"::NUMERIC(18, 4),
  ALTER COLUMN "balanceDue"     TYPE NUMERIC(18, 4) USING "balanceDue"::NUMERIC(18, 4);
