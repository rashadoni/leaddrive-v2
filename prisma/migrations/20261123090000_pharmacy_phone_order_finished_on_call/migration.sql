-- Owner's call 2026-11-03: the caller hung up before confirming and still got
-- "your order is received" on WhatsApp. The agent's final save after «təsdiq»
-- marks the order finished; only a finished order sends the pharmacy its list.
-- Nullable, no default: existing orders keep their (already sent) receipts.
ALTER TABLE "pharmacy_phone_orders" ADD COLUMN "finishedOnCallAt" TIMESTAMP(3);
