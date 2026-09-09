/**
 * YooKassa (ЮKassa) provider stub — D5 Phase 6 Block A slice 1.
 *
 * Russia/CIS payment provider. YooKassa uses HTTP Basic auth on
 * outbound calls (shopId + secretKey) and HMAC-SHA256 on incoming
 * webhook notifications, same as Stripe — webhook-verifier handles
 * the HMAC; this stub composes the signed payload according to
 * YooKassa's spec (raw body only, no timestamp prefix).
 *
 * Settings shape:
 *   { shopId: string, secretKey: string }
 */
import { registerProvider } from "../provider-registry"
import { verifyHmacSha256 } from "../webhook-verifier"
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

interface YooKassaSettings extends PaymentProviderSettings {
  shopId?: string
  secretKey?: string
}

export const yookassaProvider: PaymentProvider = {
  type: "yookassa",

  isConfigured(settings: PaymentProviderSettings): boolean {
    const s = settings as YooKassaSettings
    return Boolean(s.shopId && s.secretKey)
  },

  async createIntent(
    settings: PaymentProviderSettings,
    params: CreateIntentParams
  ): Promise<CreateIntentOutcome> {
    if (!this.isConfigured(settings)) {
      return { ok: false, error: "YooKassa provider not configured (missing shopId/secretKey)" }
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { ok: false, error: `Invalid amount: ${params.amount}` }
    }
    // YooKassa is rouble-and-CIS-currency oriented; the stub accepts
    // any 3-letter code, slice-2 may add a currency whitelist.

    return {
      ok: true,
      externalRef: `2db1f8c4-stub-${Date.now()}`,
      redirectUrl: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=stub_${Date.now()}`,
      status: "pending",
    }
  },

  async refund(
    settings: PaymentProviderSettings,
    params: RefundIntentParams
  ): Promise<RefundIntentOutcome> {
    if (!this.isConfigured(settings)) {
      return { ok: false, error: "YooKassa provider not configured" }
    }
    if (params.amount <= 0) {
      return { ok: false, error: `Refund amount must be > 0; got ${params.amount}` }
    }

    return {
      ok: true,
      refundExternalRef: `refund-stub-${Date.now()}`,
      status: "pending",
    }
  },

  async parseWebhook(params: ParseWebhookParams): Promise<ParseWebhookOutcome> {
    const { rawBody, signature, webhookSecret } = params

    // YooKassa signs the raw JSON body with HMAC-SHA256, hex-encoded.
    // No timestamp prefix (unlike Stripe).
    const sigOk = verifyHmacSha256({
      signedPayload: rawBody,
      signatureHex: signature,
      secret: webhookSecret,
    })
    if (!sigOk) {
      return { ok: false, error: "YooKassa webhook signature mismatch" }
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return { ok: false, error: "Webhook body is not valid JSON" }
    }

    // YooKassa events: { event, object: { id, ... } }. Idempotency key
    // for the (providerId, externalId) UNIQUE comes from object.id.
    const object = (payload.object as Record<string, unknown> | undefined) ?? {}
    const externalId = typeof object.id === "string" ? object.id : ""
    const eventType = typeof payload.event === "string" ? payload.event : ""
    if (!externalId || !eventType) {
      return { ok: false, error: "YooKassa webhook payload missing required fields (object.id, event)" }
    }

    return { ok: true, externalId, eventType, payload }
  },
}

registerProvider(yookassaProvider)
