-- Kapital Bank e-commerce becomes a payment provider: an invoice is paid by
-- card through the bank's hosted payment page. The row's credentials hold the
-- merchant login in the clear and the password only as tenant-bound
-- ciphertext (src/lib/payments/kapitalbank/config.ts), so the provider is
-- configured through the invoice settings, never through the generic
-- /api/v1/payment-providers routes.
ALTER TABLE "payment_providers" DROP CONSTRAINT "payment_providers_type_check";
ALTER TABLE "payment_providers"
  ADD CONSTRAINT "payment_providers_type_check"
  CHECK ("type" IN ('stripe', 'paypal', 'yookassa', 'robokassa', 'kapitalbank'));
