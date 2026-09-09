# Security audit 06: payment webhooks and forged payment completion

Date: 2026-07-22
Scope: payment provider webhooks, payment intents, refunds, invoice manual payments, and subscription transitions.

## Summary

Production currently has no configured payment providers, payment intents, or subscriptions. The app does not currently sell paid services through a payment gateway, so there is no active customer checkout flow to exploit.

The dormant payment integration code still exposed one unsafe state transition: an authenticated caller with `payments:write` could PATCH a `PaymentIntent` to provider-settled statuses such as `succeeded`. That did not directly grant product access in the current production data, but it could create false financial records and would become dangerous if the payment module were later connected to entitlements, invoices, or subscriptions.

## Evidence reviewed

- `POST /api/v1/payment-webhooks/[provider]` loads a tenant payment provider, requires a configured `webhookSecret`, verifies the provider-specific signature, inserts an idempotent webhook event row, and runs handlers in tenant context.
- Webhook event handlers update payment intent/refund status for signed provider events only.
- `POST /api/v1/payment-refunds` requires an existing tenant-owned succeeded intent and calls the provider refund flow before creating refund records.
- `POST /api/v1/invoices/[id]/payments` is a manual CRM/finance payment entry path, not a public gateway callback. It is tenant-scoped and affects invoice balance, notifications, loyalty auto-earn, and reminder chains.
- Production DB snapshot during audit: `payment_providers=0`, active providers `0`, payment intents `0`, succeeded intents `0`, subscriptions `0`, active subscriptions `0`.

## Finding fixed

### P1: Manual `PaymentIntent` PATCH could mark provider-controlled statuses

File: `src/app/api/v1/payment-intents/[id]/route.ts`

Before the fix, `PATCH /api/v1/payment-intents/[id]` accepted any status in `PAYMENT_INTENT_STATUSES` as long as the pure state machine allowed the transition. That meant a caller with `payments:write` could manually advance an intent to `succeeded`, setting `succeededAt` without a signed provider webhook.

Impact today is limited because production has no payment providers/intents/subscriptions and the current app does not sell paid services through a gateway. Impact becomes high if this module is later wired to product access, subscriptions, invoice settlement, loyalty earn, or entitlement activation.

Fix: provider-settled statuses are now rejected from manual PATCH:

- `succeeded`
- `partially_refunded`
- `refunded`

Those statuses must be reached through the signed payment webhook or the refund flow.

## Residual notes

- Manual invoice payments remain allowed because this product currently uses CRM/finance records rather than an online payment checkout. That path should stay behind finance/invoice permissions and is not equivalent to public payment confirmation.
- If online checkout is enabled later, add an end-to-end test proving product access, subscription activation, and invoice-paid side effects only occur after signed provider confirmation.
