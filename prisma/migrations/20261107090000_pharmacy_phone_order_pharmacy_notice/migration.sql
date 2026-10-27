-- The pharmacy hears of the manager's decision on WhatsApp (owner,
-- 2026-10-27: «подходит»). Delivery state of that one message per order.
ALTER TABLE "pharmacy_phone_orders" ADD COLUMN "pharmacyNotice" JSONB;
