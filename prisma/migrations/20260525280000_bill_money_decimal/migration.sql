-- Migrate Bill and BillPayment money columns from Float (DOUBLE PRECISION) to
-- NUMERIC(18,4) to eliminate IEEE-754 drift in vendor payment arithmetic.
--
-- Bill.totalAmount / paidAmount / balanceDue are used in:
--   payables/[id]/payments/route.ts — paidAmount + paymentAmount (P0 arithmetic)
--   payment-orders/[id]/execute/route.ts — paidAmount + order.amount (P0 arithmetic)
--   finance/dashboard/route.ts — reduce over balanceDue (P0 string-concat)
--
-- BillPayment.amount feeds PaymentRegistryEntry.amount (Float) via backfill script;
-- the script uses decimalToNumber() at the boundary.

ALTER TABLE "bills"
  ALTER COLUMN "totalAmount"  TYPE NUMERIC(18, 4) USING "totalAmount"::NUMERIC(18, 4),
  ALTER COLUMN "paidAmount"   TYPE NUMERIC(18, 4) USING "paidAmount"::NUMERIC(18, 4),
  ALTER COLUMN "balanceDue"   TYPE NUMERIC(18, 4) USING "balanceDue"::NUMERIC(18, 4);

ALTER TABLE "bill_payments"
  ALTER COLUMN "amount" TYPE NUMERIC(18, 4) USING "amount"::NUMERIC(18, 4);
