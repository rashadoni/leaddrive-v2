/**
 * Tests for D5 Payment Integrations slice 1 + slice 2.
 *
 * Slice-1: intent state machine + provider registry + 4 provider stubs +
 * HMAC-SHA256 webhook verifier. No DB. Pure helpers.
 *
 * Slice-2: real Stripe provider (createIntent, refund, parseWebhook).
 * stripe-node is vi.mocked — no real API calls.
 *
 * Importing `@/lib/payments` (NOT individual provider files) triggers
 * registration of all 4 providers; tests then probe the registry +
 * each provider's interface methods.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { createHmac } from "node:crypto"
import {
  advanceIntentState,
  getProvider,
  isTerminalIntentState,
  listRegisteredProviderTypes,
  verifyHmacSha256,
} from "@/lib/payments"
import {
  registerProvider,
  unregisterProvider,
} from "@/lib/payments/provider-registry"
import type { PaymentProvider } from "@/lib/payments/types"
import { stripeProvider } from "@/lib/payments/providers/stripe"
import type {
  PaymentIntentStatus,
  PaymentProviderType,
} from "@/lib/payments/types"

/* ─── Intent state machine ────────────────────────────────────────────── */

describe("D5 — advanceIntentState", () => {
  it("pending → processing emits none (no timestamp side-effect)", () => {
    const r = advanceIntentState({ from: "pending", to: "processing" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("processing → succeeded emits capturing (sets succeededAt)", () => {
    const r = advanceIntentState({ from: "processing", to: "succeeded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("capturing")
  })

  it("processing → failed emits failing (sets failedAt)", () => {
    const r = advanceIntentState({ from: "processing", to: "failed" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("failing")
  })

  it("any pre-terminal → cancelled emits cancelling", () => {
    // Explicitly covers all three pre-terminal sources, including
    // `processing → cancelled` (provider-side timeout) which is a
    // separate path from the more common `pending → cancelled`.
    for (const from of ["pending", "processing", "requires_action"] as const) {
      const r = advanceIntentState({ from, to: "cancelled" })
      // Failure surfaces in the test runner with the failing iteration
      // visible via vitest's assertion output (no per-iteration message
      // arg on toBe — that was Jest-only).
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.sideEffect).toBe("cancelling")
    }
  })

  it("succeeded → refunded emits refunding (no intent-level timestamp)", () => {
    const r = advanceIntentState({ from: "succeeded", to: "refunded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("refunding")
  })

  it("succeeded → partially_refunded emits refunding", () => {
    const r = advanceIntentState({ from: "succeeded", to: "partially_refunded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("refunding")
  })

  it("partially_refunded → partially_refunded is the ONE legit self-edge (more partial refunds)", () => {
    const r = advanceIntentState({ from: "partially_refunded", to: "partially_refunded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("refunding")
  })

  it("partially_refunded → refunded (final full refund) emits refunding", () => {
    const r = advanceIntentState({ from: "partially_refunded", to: "refunded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("refunding")
  })

  it("processing → requires_action emits none (3DS challenge round-trip)", () => {
    const r = advanceIntentState({ from: "processing", to: "requires_action" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("requires_action → processing (post-3DS retry) is allowed", () => {
    const r = advanceIntentState({ from: "requires_action", to: "processing" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("requires_action → succeeded skips the processing round-trip", () => {
    const r = advanceIntentState({ from: "requires_action", to: "succeeded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("capturing")
  })

  it("rejects pending → succeeded (must go through processing first)", () => {
    const r = advanceIntentState({ from: "pending", to: "succeeded" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("rejects same-state no-op for non-partially_refunded states", () => {
    const r = advanceIntentState({ from: "processing", to: "processing" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no-op/i)
  })

  it("rejects leaving failed terminal", () => {
    const r = advanceIntentState({ from: "failed", to: "processing" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects leaving refunded terminal", () => {
    const r = advanceIntentState({ from: "refunded", to: "succeeded" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects leaving cancelled terminal", () => {
    const r = advanceIntentState({ from: "cancelled", to: "processing" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects refunded → partially_refunded (terminal-state regression)", () => {
    const r = advanceIntentState({ from: "refunded", to: "partially_refunded" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("isTerminalIntentState matches documented terminals", () => {
    const terminal: PaymentIntentStatus[] = ["failed", "cancelled", "refunded"]
    const nonTerminal: PaymentIntentStatus[] = [
      "pending",
      "processing",
      "requires_action",
      "succeeded",
      "partially_refunded",
    ]
    for (const s of terminal) expect(isTerminalIntentState(s)).toBe(true)
    for (const s of nonTerminal) expect(isTerminalIntentState(s)).toBe(false)
  })
})

/* ─── Provider registry ───────────────────────────────────────────────── */

describe("D5 — provider registry", () => {
  it("registers all 4 slice-1 providers via the index module import", () => {
    const registered = listRegisteredProviderTypes()
    // Order is insertion-order from src/lib/payments/index.ts side-
    // effect imports — assert membership, not order.
    expect(registered).toEqual(
      expect.arrayContaining<PaymentProviderType>([
        "stripe",
        "paypal",
        "yookassa",
        "robokassa",
      ])
    )
  })

  it("getProvider resolves each registered type", () => {
    for (const type of ["stripe", "paypal", "yookassa", "robokassa"] as const) {
      const provider = getProvider(type)
      expect(provider).not.toBeNull()
      expect(provider?.type).toBe(type)
    }
  })

  it("registerProvider is last-write-wins (idempotent overwrite)", () => {
    // Simulates the case where two modules both register a `stripe`
    // provider — e.g. real impl + a test-time mock. Documented behavior
    // is last-write-wins per provider-registry.ts:28-30.
    const mockStripe: PaymentProvider = {
      type: "stripe",
      isConfigured: () => true,
      createIntent: async () => ({ ok: false, error: "MOCK_OVERRIDE" }),
      refund: async () => ({ ok: false, error: "MOCK" }),
      parseWebhook: async () => ({ ok: false, error: "MOCK" }),
    }
    registerProvider(mockStripe)
    try {
      const resolved = getProvider("stripe")
      expect(resolved).toBe(mockStripe)
      // The mock returns MOCK_OVERRIDE — proves the override actually
      // replaced the real impl, not just landed alongside it.
      // Awaiting createIntent here would surface MOCK_OVERRIDE.
    } finally {
      // Restore the real provider so subsequent tests in this file
      // (createIntent / parseWebhook integration suites below) still
      // see the genuine stripe stub.
      registerProvider(stripeProvider)
    }
    // Sanity post-restore — getProvider resolves back to the real stub.
    expect(getProvider("stripe")).toBe(stripeProvider)
  })

  it("unregisterProvider removes a registration (test-only)", () => {
    const sentinel: PaymentProvider = {
      type: "stripe",
      isConfigured: () => false,
      createIntent: async () => ({ ok: false, error: "S" }),
      refund: async () => ({ ok: false, error: "S" }),
      parseWebhook: async () => ({ ok: false, error: "S" }),
    }
    registerProvider(sentinel)
    expect(getProvider("stripe")).toBe(sentinel)
    unregisterProvider("stripe")
    expect(getProvider("stripe")).toBeNull()
    // Restore so other suites are unaffected.
    registerProvider(stripeProvider)
  })
})

/* ─── Provider configuration probes ───────────────────────────────────── */

describe("D5 — provider isConfigured()", () => {
  it("stripe rejects empty settings, accepts secretKey", () => {
    const p = getProvider("stripe")!
    expect(p.isConfigured({})).toBe(false)
    expect(p.isConfigured({ secretKey: "" })).toBe(false)
    expect(p.isConfigured({ secretKey: "sk_test_x" })).toBe(true)
  })

  it("paypal requires both clientId AND clientSecret", () => {
    const p = getProvider("paypal")!
    expect(p.isConfigured({})).toBe(false)
    expect(p.isConfigured({ clientId: "x" })).toBe(false)
    expect(p.isConfigured({ clientSecret: "y" })).toBe(false)
    expect(p.isConfigured({ clientId: "x", clientSecret: "y" })).toBe(true)
  })

  it("yookassa requires both shopId AND secretKey", () => {
    const p = getProvider("yookassa")!
    expect(p.isConfigured({})).toBe(false)
    expect(p.isConfigured({ shopId: "x" })).toBe(false)
    expect(p.isConfigured({ shopId: "x", secretKey: "y" })).toBe(true)
  })

  it("robokassa requires merchantLogin + password1 + password2", () => {
    const p = getProvider("robokassa")!
    expect(p.isConfigured({})).toBe(false)
    expect(p.isConfigured({ merchantLogin: "x", password1: "p" })).toBe(false)
    expect(
      p.isConfigured({ merchantLogin: "x", password1: "p", password2: "q" })
    ).toBe(true)
  })
})

/* ─── createIntent contract on stubs ──────────────────────────────────── */

describe("D5 — provider createIntent", () => {
  it("stripe rejects when not configured", async () => {
    const r = await getProvider("stripe")!.createIntent(
      {},
      { amount: 10, currency: "USD" }
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/secretKey/)
  })

  it("stripe rejects negative amount", async () => {
    const r = await getProvider("stripe")!.createIntent(
      { secretKey: "sk_test_x" },
      { amount: -5, currency: "USD" }
    )
    expect(r.ok).toBe(false)
  })

  it("stripe rejects malformed currency", async () => {
    const r = await getProvider("stripe")!.createIntent(
      { secretKey: "sk_test_x" },
      { amount: 10, currency: "EURO" }
    )
    expect(r.ok).toBe(false)
  })

  it("stripe (slice-2) createIntent returns externalRef from SDK", async () => {
    // Stripe provider is now slice-2 (real SDK calls, mocked here).
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_slice2_001",
      client_secret: "pi_slice2_001_secret",
      status: "requires_payment_method",
    })
    const r = await getProvider("stripe")!.createIntent(
      { secretKey: "sk_test_x" },
      { amount: 10, currency: "USD", description: "Test charge" }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalRef).toBe("pi_slice2_001")
      expect(r.clientSecret).toBe("pi_slice2_001_secret")
      expect(r.status).toBe("pending")
    }
  })

  it("paypal stub returns synthetic externalRef + redirectUrl", async () => {
    const r = await getProvider("paypal")!.createIntent(
      { clientId: "x", clientSecret: "y" },
      { amount: 10, currency: "USD" }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalRef).toMatch(/^PAYPAL-/)
      expect(r.redirectUrl).toMatch(/sandbox\.paypal\.com/)
    }
  })

  it("yookassa stub returns synthetic externalRef + redirectUrl", async () => {
    const r = await getProvider("yookassa")!.createIntent(
      { shopId: "x", secretKey: "y" },
      { amount: 100, currency: "RUB" }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalRef).toMatch(/-stub-/)
      expect(r.redirectUrl).toMatch(/yoomoney\.ru/)
    }
  })

  it("robokassa stub returns synthetic externalRef", async () => {
    const r = await getProvider("robokassa")!.createIntent(
      { merchantLogin: "x", password1: "p", password2: "q" },
      { amount: 100, currency: "RUB" }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalRef).toMatch(/^INV-/)
      expect(r.redirectUrl).toMatch(/robokassa\.ru/)
    }
  })

  it("robokassa refund is explicitly NOT supported in slice 1 (manual operator console)", async () => {
    const r = await getProvider("robokassa")!.refund(
      { merchantLogin: "x", password1: "p", password2: "q" },
      { externalRef: "INV-1", amount: 50 }
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/manual operator-console/i)
  })
})

/* ─── Webhook verifier (HMAC-SHA256) ──────────────────────────────────── */

describe("D5 — verifyHmacSha256", () => {
  const SECRET = "whsec_test_abc123"
  const PAYLOAD = '{"id":"evt_1","type":"payment_intent.succeeded"}'

  function sign(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex")
  }

  it("returns true on a valid signature", () => {
    const sig = sign(PAYLOAD, SECRET)
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: sig, secret: SECRET })).toBe(true)
  })

  it("returns false on a tampered payload", () => {
    const sig = sign(PAYLOAD, SECRET)
    const tampered = PAYLOAD.replace("succeeded", "failed")
    expect(verifyHmacSha256({ signedPayload: tampered, signatureHex: sig, secret: SECRET })).toBe(false)
  })

  it("returns false on a wrong secret (DOES NOT throw)", () => {
    const sig = sign(PAYLOAD, SECRET)
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: sig, secret: "whsec_wrong" })).toBe(false)
  })

  it("returns false on empty secret (defensive — caller should not call with empty)", () => {
    const sig = sign(PAYLOAD, SECRET)
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: sig, secret: "" })).toBe(false)
  })

  it("returns false on empty signatureHex", () => {
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: "", secret: SECRET })).toBe(false)
  })

  it("returns false on malformed signatureHex (non-hex chars)", () => {
    // SHA-256 hex is 64 chars; this is 64 chars but with non-hex letters.
    const bad = "ZZ" + "0".repeat(62)
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: bad, secret: SECRET })).toBe(false)
  })

  it("returns false on wrong-length signatureHex (e.g. 32 chars)", () => {
    expect(
      verifyHmacSha256({
        signedPayload: PAYLOAD,
        signatureHex: "a".repeat(32),
        secret: SECRET,
      })
    ).toBe(false)
  })

  it("case-insensitive on signature hex (uppercase accepted)", () => {
    const sig = sign(PAYLOAD, SECRET).toUpperCase()
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: sig, secret: SECRET })).toBe(true)
  })

  it("case-insensitive on signature hex (MIXED case accepted)", () => {
    // Defensive: providers in the wild sometimes return camelCase
    // / sentence-cased hex (yes, this happens). The normalizer
    // toLowerCase() should fold both directions.
    const sig = sign(PAYLOAD, SECRET)
    // Mix: even positions upper, odd positions lower.
    const mixed = sig
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
      .join("")
    expect(verifyHmacSha256({ signedPayload: PAYLOAD, signatureHex: mixed, secret: SECRET })).toBe(true)
  })
})

/* ─── Provider parseWebhook (signature integration) ──────────────────── */

describe("D5 — provider parseWebhook", () => {
  it("stripe parses a valid t=<ts>,v1=<sig> header + matching payload", async () => {
    const stripe = getProvider("stripe")!
    const secret = "whsec_stripe_test"
    const ts = "1736172000"
    const body = JSON.stringify({ id: "evt_xyz", type: "payment_intent.succeeded" })
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
    const header = `t=${ts},v1=${sig}`

    const r = await stripe.parseWebhook({
      rawBody: body,
      signature: header,
      webhookSecret: secret,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalId).toBe("evt_xyz")
      expect(r.eventType).toBe("payment_intent.succeeded")
    }
  })

  it("stripe rejects mismatched signature", async () => {
    const stripe = getProvider("stripe")!
    const body = JSON.stringify({ id: "evt_xyz", type: "payment_intent.succeeded" })
    const header = `t=1736172000,v1=${"a".repeat(64)}`
    const r = await stripe.parseWebhook({
      rawBody: body,
      signature: header,
      webhookSecret: "whsec_stripe_test",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/signature mismatch/i)
  })

  it("stripe rejects malformed Stripe-Signature header (no t= or v1=)", async () => {
    const stripe = getProvider("stripe")!
    const r = await stripe.parseWebhook({
      rawBody: '{"id":"x","type":"y"}',
      signature: "bogus",
      webhookSecret: "secret",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Signature header malformed/i)
  })

  it("stripe rejects valid signature but invalid JSON body", async () => {
    const stripe = getProvider("stripe")!
    const secret = "secret"
    const ts = "1"
    const body = "not json"
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
    const r = await stripe.parseWebhook({
      rawBody: body,
      signature: `t=${ts},v1=${sig}`,
      webhookSecret: secret,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/i)
  })

  it("stripe rejects payload missing id or type", async () => {
    const stripe = getProvider("stripe")!
    const secret = "secret"
    const ts = "1"
    const body = JSON.stringify({ id: "x" }) // missing type
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
    const r = await stripe.parseWebhook({
      rawBody: body,
      signature: `t=${ts},v1=${sig}`,
      webhookSecret: secret,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/missing required fields/i)
  })

  it("yookassa parses valid raw-body-signed payload", async () => {
    const yk = getProvider("yookassa")!
    const secret = "yk_secret"
    const body = JSON.stringify({ event: "payment.succeeded", object: { id: "2db1f8c4-real" } })
    const sig = createHmac("sha256", secret).update(body).digest("hex")

    const r = await yk.parseWebhook({
      rawBody: body,
      signature: sig,
      webhookSecret: secret,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalId).toBe("2db1f8c4-real")
      expect(r.eventType).toBe("payment.succeeded")
    }
  })

  it("paypal parseWebhook is explicitly NOT implemented in slice 1", async () => {
    const pp = getProvider("paypal")!
    const r = await pp.parseWebhook({
      rawBody: "{}",
      signature: "x",
      webhookSecret: "y",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not implemented in slice 1/i)
  })

  it("robokassa parseWebhook is explicitly NOT implemented in slice 1", async () => {
    const rk = getProvider("robokassa")!
    const r = await rk.parseWebhook({
      rawBody: "{}",
      signature: "x",
      webhookSecret: "y",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not implemented in slice 1/i)
  })
})

/* ─── D5 Slice-2 — real Stripe provider (stripe-node mocked) ──────────── */

// Hoist mock functions before vi.mock factory runs (Vitest hoisting requirement)
const { mockPaymentIntentsCreate, mockRefundsCreate, MockStripeError } = vi.hoisted(() => {
  class MockStripeError extends Error {
    readonly type: string
    readonly code?: string
    constructor(message: string, type = "card_error", code?: string) {
      super(message)
      this.type = type
      this.code = code
    }
  }
  return {
    mockPaymentIntentsCreate: vi.fn(),
    mockRefundsCreate: vi.fn(),
    MockStripeError,
  }
})

// Mock stripe-node — no real API calls, no network.
// Use a proper class so `new Stripe(...)` works as a constructor.
vi.mock("stripe", () => {
  class MockStripe {
    paymentIntents = { create: mockPaymentIntentsCreate }
    refunds = { create: mockRefundsCreate }
    static errors = { StripeError: MockStripeError }
    constructor(_key: string, _opts?: unknown) {}
  }
  return { default: MockStripe }
})

const SETTINGS = { secretKey: "sk_test_abc123" }

describe("D5 slice-2 — stripeProvider.createIntent", () => {
  beforeEach(() => {
    mockPaymentIntentsCreate.mockReset()
  })

  it("returns ok with externalRef and clientSecret on success", async () => {
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_test_001",
      client_secret: "pi_test_001_secret_xyz",
      status: "requires_action",
    })

    const r = await stripeProvider.createIntent(SETTINGS, { amount: 99.99, currency: "USD" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.externalRef).toBe("pi_test_001")
      expect(r.clientSecret).toBe("pi_test_001_secret_xyz")
      expect(r.status).toBe("requires_action")
    }
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9999, currency: "usd" })
    )
  })

  it("converts major-unit amount to minor-unit cents correctly", async () => {
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_x", client_secret: null, status: "succeeded" })

    await stripeProvider.createIntent(SETTINGS, { amount: 9.99, currency: "EUR" })
    // Math.round(9.99 * 100) = 999 (representable exactly in IEEE-754)
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 999, currency: "eur" })
    )
  })

  it("rejects amount < 0", async () => {
    const r = await stripeProvider.createIntent(SETTINGS, { amount: -1, currency: "USD" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid amount/i)
  })

  it("rejects amount that rounds to 0 cents", async () => {
    const r = await stripeProvider.createIntent(SETTINGS, { amount: 0.001, currency: "USD" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/too small/i)
  })

  it("rejects invalid currency code (not 3 chars)", async () => {
    const r = await stripeProvider.createIntent(SETTINGS, { amount: 10, currency: "US" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid currency/i)
  })

  it("returns error when secretKey is missing", async () => {
    const r = await stripeProvider.createIntent({}, { amount: 10, currency: "USD" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not configured/i)
  })

  it("wraps StripeError with code in error message and sets failureCode", async () => {
    mockPaymentIntentsCreate.mockRejectedValue(
      new MockStripeError("Your card was declined.", "card_error", "card_declined")
    )

    const r = await stripeProvider.createIntent(SETTINGS, { amount: 50, currency: "USD" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Confirms instanceof branch was reached (not the generic fallback)
      expect(r.error).toMatch(/card_declined/)
      expect(r.error).toMatch(/Your card was declined/)
      expect(r.failureCode).toBe("card_declined")
    }
  })

  it("maps Stripe 'canceled' (US spelling) to internal 'cancelled'", async () => {
    mockPaymentIntentsCreate.mockResolvedValue({ id: "pi_c", client_secret: null, status: "canceled" })

    const r = await stripeProvider.createIntent(SETTINGS, { amount: 10, currency: "USD" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe("cancelled")
  })
})

describe("D5 slice-2 — stripeProvider.refund", () => {
  beforeEach(() => {
    mockRefundsCreate.mockReset()
  })

  it("returns ok with refundExternalRef on success", async () => {
    mockRefundsCreate.mockResolvedValue({ id: "re_test_001", status: "succeeded" })

    const r = await stripeProvider.refund(SETTINGS, { externalRef: "pi_test_001", amount: 25.00 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.refundExternalRef).toBe("re_test_001")
      expect(r.status).toBe("succeeded")
    }
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_001", amount: 2500 })
    )
  })

  it("rejects non-pi_ externalRef", async () => {
    const r = await stripeProvider.refund(SETTINGS, { externalRef: "ch_abc", amount: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/pi_/)
  })

  it("rejects amount <= 0", async () => {
    const r = await stripeProvider.refund(SETTINGS, { externalRef: "pi_abc", amount: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/must be > 0/i)
  })

  it("returns error when secretKey is missing", async () => {
    const r = await stripeProvider.refund({}, { externalRef: "pi_abc", amount: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not configured/i)
  })

  it("wraps StripeError in refund error message with failureCode", async () => {
    mockRefundsCreate.mockRejectedValue(
      new MockStripeError("Charge already refunded.", "invalid_request_error", "charge_already_refunded")
    )

    const r = await stripeProvider.refund(SETTINGS, { externalRef: "pi_abc", amount: 50 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/charge_already_refunded/)
      expect(r.failureCode).toBe("charge_already_refunded")
    }
  })
})
