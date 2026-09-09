/**
 * Payment integrations — D5 Phase 6 Block A entry point.
 *
 * Importing this module triggers side-effect registration of all 4
 * slice-1 providers (stripe / paypal / yookassa / robokassa) into the
 * registry. Consumers should import THIS module (not individual
 * provider files) so the registry is always populated.
 *
 *   import "@/lib/payments"  // ensures registry is loaded
 *   import { getProvider } from "@/lib/payments/provider-registry"
 *
 * To add a new provider in slice 3+:
 *   1. Add the type-key to PAYMENT_PROVIDER_TYPES in types.ts
 *   2. Add a CHECK enum entry in a new migration
 *   3. Ship src/lib/payments/providers/<key>.ts
 *   4. Add an import here so the registration runs at app boot
 */
import "./providers/stripe"
import "./providers/paypal"
import "./providers/yookassa"
import "./providers/robokassa"

export { getProvider, listRegisteredProviderTypes } from "./provider-registry"
export {
  advanceIntentState,
  isTerminalIntentState,
} from "./intent-state-machine"
export { verifyHmacSha256 } from "./webhook-verifier"
export type {
  PaymentProvider,
  PaymentProviderType,
  PaymentIntentStatus,
  PaymentProviderSettings,
  CreateIntentParams,
  CreateIntentOutcome,
  RefundIntentParams,
  RefundIntentOutcome,
  ParseWebhookParams,
  ParseWebhookOutcome,
  AdvanceIntentInput,
  AdvanceIntentResult,
} from "./types"
export { PAYMENT_PROVIDER_TYPES, PAYMENT_INTENT_STATUSES } from "./types"
