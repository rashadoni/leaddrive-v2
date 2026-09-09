/**
 * Tests for D5 Payments — POST /api/v1/payment-webhooks/[provider].
 *
 * The `[provider]` segment is the PaymentProvider DB row id (not the type
 * string). Each tenant's webhook URL is unique per provider record.
 *
 * Flow tested:
 *   1. Load provider row (404 if absent, 400 if no webhookSecret).
 *   2. Resolve provider impl from registry (503 if not registered).
 *   3. parseWebhook() → signature verification (400 on failure).
 *   4. Insert PaymentWebhookEvent row — P2002 = duplicate → 200 idempotent.
 *   5. Dispatch to event handler by eventType → update event status.
 *   6. Always 200 to provider (non-200 triggers Stripe retries).
 *
 * Event handlers tested:
 *   payment_intent.succeeded   → intent advanced, event "processed"
 *   payment_intent.payment_failed → intent advanced, event "processed"
 *   payment_intent.canceled    → intent advanced, event "processed"
 *   charge.refund.updated      → refund + intent advanced, event "processed"
 *   unknown event type         → event "ignored", 200 OK
 *
 * advanceIntentState runs from importOriginal (real SM — tested in lib-payments).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ─── Mocks ─────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => {
  // Build the mock first so $transaction can close over it.
  // Passing p as tx means tx.paymentIntent.update === prisma.paymentIntent.update
  // → all existing assertions on the named mock fns still work.
  const p = {
    paymentProvider: { findFirst: vi.fn() },
    paymentWebhookEvent: { create: vi.fn(), update: vi.fn() },
    paymentIntent: { findFirst: vi.fn(), update: vi.fn() },
    paymentRefund: { findFirst: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn((fn: (tx: typeof p) => Promise<unknown>) => fn(p)),
  }
  return { prisma: p }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(() => false),
}))

vi.mock("@/lib/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments")>()
  return { ...actual, getProvider: vi.fn() }
})

import { Prisma } from "@prisma/client"
import { POST as HandleWebhook } from "@/app/api/v1/payment-webhooks/[provider]/route"
import { prisma } from "@/lib/prisma"
import { getProvider } from "@/lib/payments"

/* ─── Helpers ───────────────────────────────────────────────────────── */

function makeWebhookReq(
  url: string,
  body: unknown,
  sig = "t=1716000000,v1=aaabbbcccdddeeefffaaabbbcccdddeeefffaaabbbcccdddeeefffaaabbbc",
): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3001"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": sig,
    },
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ provider: id }) }
}

/* ─── Fixtures ──────────────────────────────────────────────────────── */

const providerRow = {
  id: "prov_1",
  organizationId: "org_1",
  type: "stripe",
  webhookSecret: "whsec_test_abc",
  isActive: true,
}

const webhookEventRow = {
  id: "whe_1",
  organizationId: "org_1",
  providerId: "prov_1",
  externalId: "evt_test_123",
  eventType: "payment_intent.succeeded",
  payload: {},
  signatureValid: true,
  status: "processing",
  processedAt: null,
  processingError: null,
  receivedAt: new Date(),
}

const intentInDB = { id: "pi_db_1", organizationId: "org_1", status: "processing" }

const succeededPayload = {
  id: "evt_test_123",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_stub_1", status: "succeeded" } },
}

// Minimal provider stub — parseWebhook succeeds by default
const mockProvider = {
  type: "stripe" as const,
  isConfigured: vi.fn(() => true),
  createIntent: vi.fn(),
  refund: vi.fn(),
  parseWebhook: vi.fn().mockResolvedValue({
    ok: true,
    externalId: "evt_test_123",
    eventType: "payment_intent.succeeded",
    payload: succeededPayload,
  }),
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore $transaction implementation after clearAllMocks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.$transaction as any).mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getProvider).mockReturnValue(mockProvider as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(providerRow as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentWebhookEvent.create).mockResolvedValue(webhookEventRow as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentWebhookEvent.update).mockResolvedValue({} as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(intentInDB as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentIntent.update).mockResolvedValue({} as any)
  mockProvider.parseWebhook.mockResolvedValue({
    ok: true,
    externalId: "evt_test_123",
    eventType: "payment_intent.succeeded",
    payload: succeededPayload,
  })
})

/* ─── Happy path — intent events ────────────────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — intent events", () => {
  it("payment_intent.succeeded → advances intent, event marked processed", async () => {
    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", succeededPayload),
      makeParams("prov_1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)

    // Intent advanced to succeeded
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "succeeded" }),
      }),
    )
    // Event marked processed
    expect(vi.mocked(prisma.paymentWebhookEvent.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "processed" }),
      }),
    )
  })

  it("payment_intent.payment_failed → advances intent to failed", async () => {
    mockProvider.parseWebhook.mockResolvedValue({
      ok: true,
      externalId: "evt_failed_1",
      eventType: "payment_intent.payment_failed",
      payload: {
        id: "evt_failed_1",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_stub_1", status: "failed" } },
      },
    })

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    )
  })

  it("payment_intent.canceled → advances intent to cancelled", async () => {
    mockProvider.parseWebhook.mockResolvedValue({
      ok: true,
      externalId: "evt_cancelled_1",
      eventType: "payment_intent.canceled",
      payload: {
        id: "evt_cancelled_1",
        type: "payment_intent.canceled",
        data: { object: { id: "pi_stub_1" } },
      },
    })
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...intentInDB, status: "processing" } as any,
    )

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
    )
  })
})

/* ─── Happy path — refund event ─────────────────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — refund event", () => {
  it("charge.refund.updated (succeeded) → refund + intent advanced", async () => {
    mockProvider.parseWebhook.mockResolvedValue({
      ok: true,
      externalId: "evt_refund_1",
      eventType: "charge.refund.updated",
      payload: {
        id: "evt_refund_1",
        type: "charge.refund.updated",
        data: { object: { id: "re_stub_1", status: "succeeded" } },
      },
    })
    vi.mocked(prisma.paymentWebhookEvent.create).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...webhookEventRow, id: "whe_refund", externalId: "evt_refund_1" } as any,
    )
    vi.mocked(prisma.paymentRefund.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "ref_1", organizationId: "org_1", status: "pending", amount: 40, paymentIntentId: "pi_db_1" } as any,
    )
    vi.mocked(prisma.paymentRefund.aggregate).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { _sum: { amount: null } } as any,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentRefund.update).mockResolvedValue({} as any)
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "pi_db_1", organizationId: "org_1", status: "succeeded", amount: 100 } as any,
    )

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )
    expect(res.status).toBe(200)

    expect(vi.mocked(prisma.paymentRefund.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) }),
    )
    // 40 < 100 → partially_refunded
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "partially_refunded" }),
      }),
    )
  })
})

/* ─── $transaction atomicity ────────────────────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — transaction atomicity", () => {
  it("intent transition uses a serializable $transaction", async () => {
    await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", succeededPayload),
      makeParams("prov_1"),
    )
    // handleIntentTransition wraps its reads + write in $transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(vi.mocked(prisma.$transaction as any)).toHaveBeenCalled()
    expect(vi.mocked(prisma.paymentIntent.findFirst)).toHaveBeenCalled()
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalled()
  })

  it("charge.refund.updated wraps refund update + intent advance in one $transaction", async () => {
    mockProvider.parseWebhook.mockResolvedValue({
      ok: true,
      externalId: "evt_tx_refund",
      eventType: "charge.refund.updated",
      payload: {
        id: "evt_tx_refund",
        type: "charge.refund.updated",
        data: { object: { id: "re_atomic_1", status: "succeeded" } },
      },
    })
    vi.mocked(prisma.paymentWebhookEvent.create).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...webhookEventRow, id: "whe_tx", externalId: "evt_tx_refund" } as any,
    )
    vi.mocked(prisma.paymentRefund.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "ref_atomic", organizationId: "org_1", status: "pending", amount: 30, paymentIntentId: "pi_db_1" } as any,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentRefund.aggregate).mockResolvedValue({ _sum: { amount: null } } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentRefund.update).mockResolvedValue({} as any)
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "pi_db_1", organizationId: "org_1", status: "succeeded", amount: 100 } as any,
    )

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )
    expect(res.status).toBe(200)

    // Both writes happened (inside the same $transaction)
    expect(vi.mocked(prisma.paymentRefund.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) }),
    )
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "partially_refunded" }) }),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(vi.mocked(prisma.$transaction as any)).toHaveBeenCalled()
  })
})

/* ─── Idempotency & ignored events ──────────────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — dedup & ignore", () => {
  it("duplicate externalId (P2002) → 200 idempotent, no re-processing", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `payment_webhook_events_org_provider_external_key`",
      { code: "P2002", clientVersion: "5.x" },
    )
    vi.mocked(prisma.paymentWebhookEvent.create).mockRejectedValue(p2002)

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", succeededPayload),
      makeParams("prov_1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.duplicate).toBe(true)
    // Intent must NOT have been advanced
    expect(vi.mocked(prisma.paymentIntent.update)).not.toHaveBeenCalled()
  })

  it("unknown event type → 200, event marked ignored", async () => {
    mockProvider.parseWebhook.mockResolvedValue({
      ok: true,
      externalId: "evt_unknown_1",
      eventType: "customer.subscription.created",
      payload: {},
    })
    vi.mocked(prisma.paymentWebhookEvent.create).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...webhookEventRow, eventType: "customer.subscription.created" } as any,
    )

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ignored).toBe(true)
    expect(vi.mocked(prisma.paymentWebhookEvent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ignored" }) }),
    )
  })

  it("intent not found by externalRef → 200, event ignored", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(null)

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", succeededPayload),
      makeParams("prov_1"),
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.paymentWebhookEvent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ignored" }) }),
    )
  })
})

/* ─── SM failure — always 200 to provider ───────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — SM rejection", () => {
  it("SM rejects transition → event marked failed, still 200 to provider", async () => {
    // intent already in terminal 'succeeded', trying to advance to 'succeeded' (self-edge rejected)
    // Actually let's do: intent is 'failed' (terminal) trying to advance to 'succeeded'
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...intentInDB, status: "failed" } as any,
    )

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", succeededPayload),
      makeParams("prov_1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    // Event marked failed (SM error logged, not re-thrown)
    expect(vi.mocked(prisma.paymentWebhookEvent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    )
    // Intent NOT updated (SM blocked it)
    expect(vi.mocked(prisma.paymentIntent.update)).not.toHaveBeenCalled()
  })
})

/* ─── Error paths ───────────────────────────────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — error paths", () => {
  it("returns 404 when provider not found", async () => {
    vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(null)
    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/ghost", {}),
      makeParams("ghost"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 410 when provider is disabled (isActive: false)", async () => {
    vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...providerRow, isActive: false } as any,
    )
    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )
    expect(res.status).toBe(410)
  })

  it("returns 400 when provider has no webhookSecret", async () => {
    vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...providerRow, webhookSecret: null } as any,
    )
    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/webhook secret/i)
  })

  it("returns 400 when signature verification fails", async () => {
    mockProvider.parseWebhook.mockResolvedValue({
      ok: false,
      error: "Stripe-Signature header malformed",
    })
    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}, "bad_sig"),
      makeParams("prov_1"),
    )
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/signature/i)
  })

  it("returns 503 when provider not in registry", async () => {
    vi.mocked(getProvider).mockReturnValue(null)
    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", {}),
      makeParams("prov_1"),
    )
    expect(res.status).toBe(503)
  })
})

/* ─── P2034 in-process retry ─────────────────────────────────────────── */

describe("POST /api/v1/payment-webhooks/[provider] — P2034 in-process retry", () => {
  it("serialization failure (P2034) on first attempt → retries, succeeds on second", async () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError(
      "Transaction failed due to a write conflict or a deadlock",
      { code: "P2034", clientVersion: "5.x" },
    )
    // First $transaction call throws P2034; second call succeeds normally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction as any)
      .mockRejectedValueOnce(p2034)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementationOnce((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))

    const res = await HandleWebhook(
      makeWebhookReq("/api/v1/payment-webhooks/prov_1", succeededPayload),
      makeParams("prov_1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    // $transaction called twice: first failed with P2034, second succeeded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(vi.mocked(prisma.$transaction as any)).toHaveBeenCalledTimes(2)
    // Callback only executed on attempt 2 (first rejected before invoking callback)
    expect(vi.mocked(prisma.paymentIntent.findFirst)).toHaveBeenCalledTimes(1)
    // Intent was updated on the successful second attempt
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) }),
    )
    // Event marked processed (not failed)
    expect(vi.mocked(prisma.paymentWebhookEvent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "processed" }) }),
    )
  })
})
