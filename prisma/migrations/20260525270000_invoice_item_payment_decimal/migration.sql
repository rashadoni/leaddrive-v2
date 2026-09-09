-- InvoiceItem.unitPrice + InvoiceItem.total — Float → Decimal(18,4)
-- InvoicePayment.amount                       — Float → Decimal(18,4)
--
-- quantity / discount / taxRate stay Float — they are quantities/rates/percentages,
-- not money amounts. Only columns that carry a currency value become Decimal.

ALTER TABLE "invoice_items"
  ALTER COLUMN "unitPrice" TYPE NUMERIC(18, 4) USING "unitPrice"::NUMERIC(18, 4),
  ALTER COLUMN "total"     TYPE NUMERIC(18, 4) USING "total"::NUMERIC(18, 4);

ALTER TABLE "invoice_payments"
  ALTER COLUMN "amount" TYPE NUMERIC(18, 4) USING "amount"::NUMERIC(18, 4);
