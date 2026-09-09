/**
 * PayPal provider stub — D5 Phase 6 Block A slice 1.
 *
 * PayPal's PaymentsV2 API uses HMAC + PAYPAL-CERT-URL signature
 * verification (cert-rotation chain). Slice 1 stubs both methods —
 * `isConfigured` validates clientId + clientSecret presence;
 * `parseWebhook` rejects with a clear "not implemented in slice 1"
 * error so route tests can assert the path is wired but disabled.
 * Slice 2 wires `@paypal/checkout-server-sdk` and the real verifier.
 *
 * Settings shape (PaymentProvider.credentials JSON):
 *   { clientId: string, clientSecret: string, webhookId?: string }
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

interface PaypalSettings extends PaymentProviderSettings {
  clientId?: string
  clientSecret?: string
  webhookId?: string
}

export const paypalProvider: PaymentProvider = {
  type: "paypal",

  isConfigured(settings: PaymentProviderSettings): boolean {
    const s = settings as PaypalSettings
    return Boolean(s.clientId && s.clientSecret)
  },

  async createIntent(
    settings: PaymentProviderSettings,
    params: CreateIntentParams
  ): Promise<CreateIntentOutcome> {
    if (!this.isConfigured(settings)) {
      return { ok: false, error: "PayPal provider not configured (missing clientId/clientSecret)" }
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { ok: false, error: `Invalid amount: ${params.amount}` }
    }

    return {
      ok: true,
      externalRef: `PAYPAL-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      redirectUrl: `https://www.sandbox.paypal.com/checkoutnow?token=stub_${Date.now()}`,
      status: "pending",
    }
  },

  async refund(
    settings: PaymentProviderSettings,
    params: RefundIntentParams
  ): Promise<RefundIntentOutcome> {
    if (!this.isConfigured(settings)) {
      return { ok: false, error: "PayPal provider not configured" }
    }
    if (params.amount <= 0) {
      return { ok: false, error: `Refund amount must be > 0; got ${params.amount}` }
    }

    return {
      ok: true,
      refundExternalRef: `PAYPAL-REF-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      status: "pending",
    }
  },

  async parseWebhook(_params: ParseWebhookParams): Promise<ParseWebhookOutcome> {
    // PayPal webhook verification requires fetching the cert chain
    // from `paypal-cert-url` header + RSA-SHA256 signature check
    // against the canonical CRC32 payload. Out of scope for slice-1
    // stub — slice-2 wires this via `@paypal/checkout-server-sdk`.
    return {
      ok: false,
      error: "PayPal webhook verification not implemented in slice 1 stub — see slice-2 SDK integration",
    }
  },
}

registerProvider(paypalProvider)
