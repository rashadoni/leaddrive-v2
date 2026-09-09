/**
 * Stripe provider — D5 Phase 6 Block A slice 2.
 *
 * Slice-2: wires `stripe-node` for real `createIntent` and `refund` calls.
 * `parseWebhook` uses HMAC-SHA256 (same as slice-1) — canonical Stripe
 * signature format (`t=<timestamp>,v1=<hex>`).
 *
 * Amount conventions:
 *   Internal storage  — Decimal(18,4) major-unit (e.g. 99.9900 USD)
 *   Stripe API        — integer minor-unit (e.g. 9999 cents)
 *   Conversion        — Math.round(amount * 100); result must be ≥ 1
 *
 *   Zero-decimal currencies (JPY, KRW, …) are NOT currently handled —
 *   they would require multiplying by 1 instead of 100. Add a currency
 *   lookup table here when those currencies are onboarded.
 *
 * Settings shape (PaymentProvider.credentials JSON):
 *   { secretKey: string       — `sk_test_...` / `sk_live_...`
 *     publishableKey?: string — `pk_test_...` / `pk_live_...`
 *     webhookSecret?: string  — `whsec_...`
 *     apiVersion?: string }
 */
import Stripe from "stripe"
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

const STRIPE_API_VERSION = "2026-04-22.dahlia" as const

interface StripeSettings extends PaymentProviderSettings {
  secretKey?: string
  publishableKey?: string
  apiVersion?: string
}

/**
 * Parse Stripe's `Stripe-Signature` header: `t=<unix_ts>,v1=<hex>,v0=<hex_legacy>?`.
 * Returns null if the header is malformed.
 */
function parseStripeSignatureHeader(
  header: string
): { timestamp: string; v1: string } | null {
  const parts = header.split(",").map((p) => p.trim())
  let timestamp = ""
  let v1 = ""
  for (const part of parts) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    const key = part.slice(0, eq)
    const val = part.slice(eq + 1)
    if (key === "t") timestamp = val
    else if (key === "v1") v1 = val
  }
  if (!timestamp || !v1) return null
  return { timestamp, v1 }
}

/** Convert major-unit amount (e.g. 9.99) to Stripe minor-unit cents (999). */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100)
}

/** Map Stripe PaymentIntent status to our internal status. */
function mapStripeIntentStatus(
  stripeStatus: Stripe.PaymentIntent.Status
): "pending" | "requires_action" | "succeeded" | "failed" | "cancelled" {
  switch (stripeStatus) {
    case "succeeded": return "succeeded"
    case "canceled": return "cancelled"
    case "requires_action": return "requires_action"
    // Intentional: Stripe "processing" maps to our "pending" because
    // the DB intent starts at "pending" and a webhook transitions it
    // to "processing" once Stripe confirms the charge is in flight.
    // Returning "processing" here would skip that webhook transition.
    case "processing":
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_capture":
    default: return "pending"
  }
}

/** Map Stripe Refund status to our internal status. */
function mapStripeRefundStatus(
  stripeStatus: string | null | undefined
): "pending" | "succeeded" | "failed" {
  switch (stripeStatus) {
    case "succeeded": return "succeeded"
    case "failed": return "failed"
    default: return "pending"
  }
}

export const stripeProvider: PaymentProvider = {
  type: "stripe",

  isConfigured(settings: PaymentProviderSettings): boolean {
    const s = settings as StripeSettings
    return Boolean(s.secretKey && s.secretKey.length > 0)
  },

  async createIntent(
    settings: PaymentProviderSettings,
    params: CreateIntentParams
  ): Promise<CreateIntentOutcome> {
    const s = settings as StripeSettings
    if (!s.secretKey) {
      return { ok: false, error: "Stripe provider not configured (missing secretKey)" }
    }
    if (!Number.isFinite(params.amount) || params.amount < 0) {
      return { ok: false, error: `Invalid amount: ${params.amount}` }
    }
    if (params.currency.length !== 3) {
      return { ok: false, error: `Invalid currency code: ${params.currency}` }
    }

    const amountMinor = toMinorUnits(params.amount)
    if (amountMinor < 1) {
      return { ok: false, error: `Amount too small after conversion to minor units: ${params.amount}` }
    }

    try {
      const stripe = new Stripe(s.secretKey, {
        apiVersion: (s.apiVersion ?? STRIPE_API_VERSION) as typeof STRIPE_API_VERSION,
      })

      const intent = await stripe.paymentIntents.create({
        amount: amountMinor,
        currency: params.currency.toLowerCase(),
        description: params.description ?? undefined,
        metadata: params.metadata as Record<string, string> | undefined,
        automatic_payment_methods: { enabled: true },
      })

      return {
        ok: true,
        externalRef: intent.id,
        clientSecret: intent.client_secret ?? undefined,
        status: mapStripeIntentStatus(intent.status),
      }
    } catch (err) {
      const stripeErr = err instanceof Stripe.errors.StripeError ? err : null
      return {
        ok: false,
        error: stripeErr
          ? `Stripe API error (${stripeErr.code ?? stripeErr.type}): ${stripeErr.message}`
          : `Stripe createIntent failed: ${(err as Error).message ?? String(err)}`,
        failureCode: stripeErr?.code ?? undefined,
      }
    }
  },

  async refund(
    settings: PaymentProviderSettings,
    params: RefundIntentParams
  ): Promise<RefundIntentOutcome> {
    const s = settings as StripeSettings
    if (!s.secretKey) {
      return { ok: false, error: "Stripe provider not configured" }
    }
    if (!params.externalRef.startsWith("pi_")) {
      return {
        ok: false,
        error: `Refund externalRef must be a Stripe PaymentIntent id (pi_...); got ${params.externalRef}`,
      }
    }
    if (params.amount <= 0) {
      return { ok: false, error: `Refund amount must be > 0; got ${params.amount}` }
    }

    const amountMinor = toMinorUnits(params.amount)
    if (amountMinor < 1) {
      return { ok: false, error: `Refund amount too small after conversion: ${params.amount}` }
    }

    try {
      const stripe = new Stripe(s.secretKey, {
        apiVersion: (s.apiVersion ?? STRIPE_API_VERSION) as typeof STRIPE_API_VERSION,
      })

      const refund = await stripe.refunds.create({
        payment_intent: params.externalRef,
        amount: amountMinor,
        reason: (params.reason ?? undefined) as Stripe.RefundCreateParams.Reason | undefined,
      })

      return {
        ok: true,
        refundExternalRef: refund.id,
        status: mapStripeRefundStatus(refund.status),
      }
    } catch (err) {
      const stripeErr = err instanceof Stripe.errors.StripeError ? err : null
      return {
        ok: false,
        error: stripeErr
          ? `Stripe refund error (${stripeErr.code ?? stripeErr.type}): ${stripeErr.message}`
          : `Stripe refund failed: ${(err as Error).message ?? String(err)}`,
        failureCode: stripeErr?.code ?? undefined,
      }
    }
  },

  async parseWebhook(params: ParseWebhookParams): Promise<ParseWebhookOutcome> {
    const { rawBody, signature, webhookSecret } = params

    const parsedHeader = parseStripeSignatureHeader(signature)
    if (!parsedHeader) {
      return { ok: false, error: "Stripe-Signature header malformed" }
    }

    // Stripe signs `{timestamp}.{rawBody}` — verify per docs.
    const signedPayload = `${parsedHeader.timestamp}.${rawBody}`
    const sigOk = verifyHmacSha256({
      signedPayload,
      signatureHex: parsedHeader.v1,
      secret: webhookSecret,
    })
    if (!sigOk) {
      return { ok: false, error: "Stripe webhook signature mismatch" }
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return { ok: false, error: "Webhook body is not valid JSON" }
    }

    const externalId = typeof payload.id === "string" ? payload.id : ""
    const eventType = typeof payload.type === "string" ? payload.type : ""
    if (!externalId || !eventType) {
      return { ok: false, error: "Webhook payload missing required fields (id, type)" }
    }

    return { ok: true, externalId, eventType, payload }
  },
}

registerProvider(stripeProvider)
