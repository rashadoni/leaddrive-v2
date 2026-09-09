/**
 * Robokassa provider stub — D5 Phase 6 Block A slice 1.
 *
 * Russia/CIS payment provider. Robokassa is older than YooKassa and
 * historically uses MD5 (with optional SHA-1 / SHA-256 password
 * variants) on a colon-joined signature payload — NOT HMAC. The stub
 * documents the format but defers actual verification to slice 2
 * (Robokassa's API is significantly less standardized than Stripe /
 * PayPal / YooKassa; a stub that pretends to verify would be worse
 * than one that explicitly rejects).
 *
 * Settings shape:
 *   { merchantLogin: string, password1: string, password2: string,
 *     algorithm?: "md5" | "sha1" | "sha256" }
 */
import { registerProvider } from "../provider-registry"
import type {
  CreateIntentOutcome,
  CreateIntentParams,
  ParseWebhookOutcome,
  ParseWebhookParams,
  PaymentProvider,
  PaymentProviderSettings,
  RefundIntentOutcome,
  RefundIntentParams,
} from "../types"

interface RobokassaSettings extends PaymentProviderSettings {
  merchantLogin?: string
  password1?: string
  password2?: string
  algorithm?: "md5" | "sha1" | "sha256"
}

export const robokassaProvider: PaymentProvider = {
  type: "robokassa",

  isConfigured(settings: PaymentProviderSettings): boolean {
    const s = settings as RobokassaSettings
    return Boolean(s.merchantLogin && s.password1 && s.password2)
  },

  async createIntent(
    settings: PaymentProviderSettings,
    params: CreateIntentParams
  ): Promise<CreateIntentOutcome> {
    if (!this.isConfigured(settings)) {
      return { ok: false, error: "Robokassa provider not configured (missing merchantLogin/password1/password2)" }
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { ok: false, error: `Invalid amount: ${params.amount}` }
    }

    return {
      ok: true,
      externalRef: `INV-${Date.now()}`,
      // Robokassa returns a hosted-checkout redirect URL with the
      // params baked into the query string + signature. Slice 2
      // composes the actual URL.
      redirectUrl: `https://auth.robokassa.ru/Merchant/Index.aspx?stub=${Date.now()}`,
      status: "pending",
    }
  },

  async refund(
    settings: PaymentProviderSettings,
    _params: RefundIntentParams
  ): Promise<RefundIntentOutcome> {
    if (!this.isConfigured(settings)) {
      return { ok: false, error: "Robokassa provider not configured" }
    }
    // Robokassa refunds go through a separate operator console flow,
    // not the public API — slice 2 may add a manual-refund admin
    // action that emits the PaymentRefund row + opens the console.
    return {
      ok: false,
      error: "Robokassa refunds require manual operator-console action — slice 2 admin flow",
    }
  },

  async parseWebhook(_params: ParseWebhookParams): Promise<ParseWebhookOutcome> {
    // Robokassa's signature format: MD5("OutSum:InvId:password2[:custom_params]")
    // varies by deployment and requires a per-tenant parameter map.
    // Defer to slice 2 — stub returns error so the route doesn't
    // silently accept unverified payloads.
    return {
      ok: false,
      error: "Robokassa webhook verification not implemented in slice 1 stub — see slice-2 integration",
    }
  },
}

registerProvider(robokassaProvider)
