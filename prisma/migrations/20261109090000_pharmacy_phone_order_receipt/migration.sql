-- The pharmacy gets its order's lines on WhatsApp when the call ends (owner,
-- 2026-10-27: «Да, подавай шаблон с составом заказа»). Delivery state of that
-- one message per order.
ALTER TABLE "pharmacy_phone_orders" ADD COLUMN "pharmacyReceipt" JSONB;
