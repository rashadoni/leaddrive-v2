/**
 * Payment integrations types — D5 Phase 6 Block A slice 1.
 *
 * Pluggable provider pattern mirroring src/lib/sms/providers/. Each
 * concrete provider (stripe / paypal / yookassa / robokassa) implements
 * the `PaymentProvider` interface; the registry resolves one per
 * PaymentIntent based on the `providerId` FK.
 *
 * Slice 1 ships the abstraction + state machine + webhook signature
 * verifier + stubbed provider implementations (interface-conforming,
 * no real SDK calls). Slice 2 wires actual API calls + webhook
 * handler endpoints; slice 3 wires the Stripe Elements checkout UI.
 *
 * ✅ SLICE-2 P0 RESOLVED (2026-05-24): `amount` on PaymentIntent /
 * PaymentRefund migrated from Float → Decimal(18,4) in migration
 * 20260524210000_d5_d8_float_to_decimal. IEEE-754 drift eliminated.
 * LoyaltyTier.multiplier + LoyaltyEarnRule.pointsRate / minOrderAmount
 * co-migrated in the same PR (D8 TODO(D5-decimal) markers removed).
 */

/* ─── Provider type registry ──────────────────────────────────────────── */

/**
 * Tuple of supported provider keys — single source of truth. Matches
 * the DB CHECK at migration `payment_providers_type_check`. To add a
 * new provider: (1) extend this tuple, (2) add a CHECK enum entry in
 * a new migration, (3) ship a concrete provider file under
 * `src/lib/payments/providers/<key>.ts`, (4) register it in
 * `src/lib/payments/provider-registry.ts`.
 */
export const PAYMENT_PROVIDER_TYPES = [
  "stripe",
  "paypal",
  "yookassa",
  "robokassa",
] as const

export type PaymentProviderType = (typeof PAYMENT_PROVIDER_TYPES)[number]

/* ─── PaymentIntent state machine ─────────────────────────────────────── */

/**
 * Statuses match the DB CHECK at `payment_intents_status_check`.
 *   pending           — created locally, not yet sent to provider
 *   processing        — provider is handling the charge
 *   requires_action   — buyer must complete 3DS / SCA on the front-end
 *   succeeded         — money captured
 *   failed            — terminal: charge declined / provider error
 *   cancelled         — terminal: caller cancelled before capture
 *   refunded          — terminal: full refund applied
 *   partially_refunded — succeeded charge with at least one partial refund
 */
export const PAYMENT_INTENT_STATUSES = [
  "pending",
  "processing",
  "requires_action",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const

export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number]

/**
 * Forward transitions.
 *
 *   pending → processing, cancelled
 *   processing → requires_action, succeeded, failed, cancelled
 *   requires_action → processing (after 3DS challenge clears), succeeded, failed, cancelled
 *   succeeded → refunded, partially_refunded
 *   partially_refunded → partially_refunded (more partial refunds), refunded
 *   failed / cancelled / refunded — terminal
 *
 * Note: requires_action → processing is allowed because 3DS may
 * round-trip the intent through "needs more info" multiple times
 * (Stripe pattern).
 *
 * ✅ SLICE-2 DECISION: `failed` is terminal — no `failed → refunded` edge.
 * Rationale: `payment_intent.payment_failed` means no funds were captured,
 * so there is nothing to refund. `charge.dispute.funds_withdrawn` from
 * Stripe always arrives on an intent that reached `succeeded` before the
 * dispute; those follow the `succeeded → partially_refunded / refunded`
 * path. Chargebacks on genuinely failed intents emit a PaymentWebhookEvent
 * row (for audit) and do not mutate intent status — intentional and safe.
 */
export const PAYMENT_INTENT_TRANSITIONS: Readonly<
  Record<PaymentIntentStatus, readonly PaymentIntentStatus[]>
> = {
  pending: ["processing", "cancelled"],
  processing: ["requires_action", "succeeded", "failed", "cancelled"],
  requires_action: ["processing", "succeeded", "failed", "cancelled"],
  succeeded: ["refunded", "partially_refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  failed: [],
  cancelled: [],
  refunded: [],
}

export interface AdvanceIntentInput {
  from: PaymentIntentStatus
  to: PaymentIntentStatus
}

export interface AdvanceIntentOk {
  ok: true
  /**
   * Hints which timestamp side-effect to write:
   *   capturing     — set succeededAt = now()
   *   failing       — set failedAt = now()
   *   cancelling    — set cancelledAt = now()
   *   refunding     — no intent-level timestamp (PaymentRefund row carries it)
   *   none          — pending→processing, requires_action loops, etc.
   */
  sideEffect: "capturing" | "failing" | "cancelling" | "refunding" | "none"
}

export interface AdvanceIntentFail {
  ok: false
  error: string
}

export type AdvanceIntentResult = AdvanceIntentOk | AdvanceIntentFail

/* ─── Provider interface ──────────────────────────────────────────────── */

/**
 * Free-form per-provider settings shape. Concrete providers cast to
 * their own typed sub-interface (e.g. Stripe → `{ secretKey: string; ... }`).
 */
export interface PaymentProviderSettings {
  [key: string]: unknown
}

export interface CreateIntentParams {
  amount: number
  currency: string
  description?: string
  customerEmail?: string
  metadata?: Record<string, unknown>
}

export interface CreateIntentResult {
  ok: true
  externalRef: string
  /** Client-side secret / approval URL the front-end uses to complete the charge. */
  clientSecret?: string
  redirectUrl?: string
  status: PaymentIntentStatus
}

export interface CreateIntentFail {
  ok: false
  error: string
  failureCode?: string
}

export type CreateIntentOutcome = CreateIntentResult | CreateIntentFail

export interface RefundIntentParams {
  externalRef: string
  amount: number
  reason?: string
}

export interface RefundIntentOk {
  ok: true
  refundExternalRef: string
  /** Provider's reported refund status (mapped to our enum by the caller). */
  status: "pending" | "processing" | "succeeded" | "failed"
}

export interface RefundIntentFail {
  ok: false
  error: string
  failureCode?: string
}

export type RefundIntentOutcome = RefundIntentOk | RefundIntentFail

export interface ParseWebhookParams {
  /** Raw request body — providers sign the body byte-for-byte. */
  rawBody: string
  /** Provider-specific signature header value. */
  signature: string
  /** Webhook secret from PaymentProvider.webhookSecret. */
  webhookSecret: string
}

export interface ParseWebhookOk {
  ok: true
  /** Provider's event id — used for idempotency dedupe. */
  externalId: string
  eventType: string
  /** Parsed JSON payload — Prisma `payload Json` column. */
  payload: Record<string, unknown>
}

export interface ParseWebhookFail {
  ok: false
  error: string
}

export type ParseWebhookOutcome = ParseWebhookOk | ParseWebhookFail

/**
 * Concrete providers implement this interface. Identity is the `type`
 * field — registry looks up by `PaymentProviderType`.
 */
export interface PaymentProvider {
  readonly type: PaymentProviderType

  /**
   * Cheap config-validity check — used before the route attempts to
   * call `createIntent`. Returns false if settings/credentials are
   * missing or malformed.
   */
  isConfigured(settings: PaymentProviderSettings): boolean

  /**
   * Create a payment intent at the provider. Slice 1 stubs return a
   * synthetic ok with a fake externalRef so route tests can run
   * end-to-end without external dependencies.
   */
  createIntent(
    settings: PaymentProviderSettings,
    params: CreateIntentParams
  ): Promise<CreateIntentOutcome>

  /**
   * Refund (partial or full) against an existing intent. Caller writes
   * the PaymentRefund row using the returned externalRef.
   */
  refund(
    settings: PaymentProviderSettings,
    params: RefundIntentParams
  ): Promise<RefundIntentOutcome>

  /**
   * Verify the webhook signature + parse the payload. Returns an
   * idempotency-ready `externalId` the caller can use to dedupe
   * retries via the (providerId, externalId) UNIQUE index.
   */
  parseWebhook(params: ParseWebhookParams): Promise<ParseWebhookOutcome>
}
