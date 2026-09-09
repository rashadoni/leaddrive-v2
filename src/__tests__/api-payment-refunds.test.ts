/**
 * Tests for D5 Payments — /api/v1/payment-refunds routes.
 *
 * Covers:
 *   POST /api/v1/payment-refunds        — create refund against a succeeded intent.
 *     - Provider stub flow: getProvider → provider.refund() → PaymentRefund row.
 *     - Intent status advancement: if provider reports "succeeded", intent moves
 *       to "partially_refunded" (partial) or "refunded" (full).
 *     - Aggregate guard: existing non-failed refunds sum + new amount must not
 *       exceed intent.amount.
 *   GET  /api/v1/payment-refunds        — list with paymentIntentId / status filter.
 *   GET  /api/v1/payment-refunds/[id]   — detail with amount as number.
 *
 * advanceIntentState is used via importOriginal (real SM — no re-mock).
 * No real DB — prisma fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

/* ─── Mocks ─────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => {
  // Build the mock prisma object first so $transaction can reference it.
  // $transaction passes the mock itself as `tx` so every tx.xxx call
  // goes to the same vi.fn() instances and existing assertions still work.
  const p = {
    paymentIntent: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    paymentRefund: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn((fn: (tx: typeof p) => Promise<unknown>) => fn(p)),
  }
  return { prisma: p }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

vi.mock("@/lib/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments")>()
  return { ...actual, getProvider: vi.fn() }
})

import { GET as ListRefunds, POST as CreateRefund } from "@/app/api/v1/payment-refunds/route"
import { GET as GetRefund } from "@/app/api/v1/payment-refunds/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getProvider } from "@/lib/payments"

/* ─── Helpers ───────────────────────────────────────────────────────── */

const AUTH_OK = { orgId: "org_1", userId: "user_1" }

function makeReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3001"), {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// Provider stub — refund() succeeds with "pending" status by default
const mockProvider = {
  type: "stripe" as const,
  isConfigured: vi.fn(() => true),
  createIntent: vi.fn(),
  refund: vi.fn().mockResolvedValue({
    ok: true,
    refundExternalRef: "re_stub_test123",
    status: "pending",
  }),
  parseWebhook: vi.fn(),
}

// Intent with embedded provider data (as returned by Prisma nested select)
const succeededIntent = {
  id: "pi_1",
  organizationId: "org_1",
  status: "succeeded",
  amount: 100,
  currency: "USD",
  externalRef: "pi_stub_1",
  providerId: "prov_1",
  provider: {
    type: "stripe",
    isActive: true,
    credentials: { secretKey: "sk_test_abc" },
  },
}

// Created refund row returned by prisma.paymentRefund.create mock
const createdRefundRow = {
  id: "ref_new",
  organizationId: "org_1",
  paymentIntentId: "pi_1",
  externalRef: "re_stub_test123",
  amount: 40,
  currency: "USD",
  status: "pending",
  reason: null,
  failureCode: null,
  failureMessage: null,
  succeededAt: null,
  failedAt: null,
  createdBy: "user_1",
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore $transaction after clearAllMocks (implementation is cleared by resetAllMocks
  // but clearAllMocks only clears recorded calls — restore here for safety).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.$transaction as any).mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getProvider).mockReturnValue(mockProvider as any)
  mockProvider.refund.mockResolvedValue({
    ok: true,
    refundExternalRef: "re_stub_test123",
    status: "pending",
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(succeededIntent as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentRefund.create).mockResolvedValue(createdRefundRow as any)
  // Default: no existing refunds for aggregate sum check
  vi.mocked(prisma.paymentRefund.aggregate).mockResolvedValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { _sum: { amount: null } } as any,
  )
})

/* ─── POST create ───────────────────────────────────────────────────── */

describe("POST /api/v1/payment-refunds", () => {
  const validBody = { paymentIntentId: "pi_1", amount: 40, reason: "requested_by_customer" }

  it("creates refund (provider pending) — intent status unchanged", async () => {
    // provider returns pending → no intent status update
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.refund.id).toBe("ref_new")
    expect(typeof json.refund.amount).toBe("number")
    expect(json.refund.amount).toBe(40)
    expect(json.refund.status).toBe("pending")
    // intent status unchanged → intentStatus should reflect original
    expect(json.intentStatus).toBe("succeeded")
    // intent.update should NOT have been called (refund still pending)
    expect(vi.mocked(prisma.paymentIntent.update)).not.toHaveBeenCalled()
  })

  it("full refund: provider succeeded → intent advances to 'refunded'", async () => {
    mockProvider.refund.mockResolvedValue({
      ok: true,
      refundExternalRef: "re_stub_full",
      status: "succeeded",
    })
    // Full refund: amount = 100 = intent.amount, no prior refunds
    vi.mocked(prisma.paymentRefund.create).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...createdRefundRow, amount: 100, status: "succeeded", succeededAt: new Date() } as any,
    )

    const res = await CreateRefund(
      makeReq("/api/v1/payment-refunds", "POST", { paymentIntentId: "pi_1", amount: 100 }),
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.intentStatus).toBe("refunded")
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "refunded" }) }),
    )
  })

  it("partial refund: provider succeeded → intent advances to 'partially_refunded'", async () => {
    mockProvider.refund.mockResolvedValue({
      ok: true,
      refundExternalRef: "re_stub_partial",
      status: "succeeded",
    })
    // Partial refund: amount = 40 < intent.amount = 100, no prior refunds
    vi.mocked(prisma.paymentRefund.create).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...createdRefundRow, amount: 40, status: "succeeded", succeededAt: new Date() } as any,
    )

    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.intentStatus).toBe("partially_refunded")
    expect(vi.mocked(prisma.paymentIntent.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "partially_refunded" }) }),
    )
  })

  it("returns 400 when missing paymentIntentId", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paymentIntentId: _pid, ...body } = validBody
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when missing amount", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { amount: _amt, ...body } = validBody
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when provider is inactive", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...succeededIntent, provider: { ...succeededIntent.provider, isActive: false } } as any,
    )
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/disabled/i)
  })

  it("returns 400 when amount is zero or negative", async () => {
    for (const bad of [0, -1, -0.01]) {
      const res = await CreateRefund(
        makeReq("/api/v1/payment-refunds", "POST", { ...validBody, amount: bad }),
      )
      expect(res.status).toBe(400)
    }
  })

  it("returns 400 when refund amount exceeds remaining refundable balance", async () => {
    // existing succeeded refunds sum = 70; new request = 40 → 70+40=110 > 100
    vi.mocked(prisma.paymentRefund.aggregate).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { _sum: { amount: 70 } } as any,
    )
    const res = await CreateRefund(
      makeReq("/api/v1/payment-refunds", "POST", { ...validBody, amount: 40 }),
    )
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/exceed/i)
  })

  it("returns 404 when intent not found", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(null)
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    expect(res.status).toBe(404)
  })

  it("returns 422 when intent is not in a refundable state", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...succeededIntent, status: "pending" } as any,
    )
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.error).toMatch(/refund/i)
  })

  it("returns 503 when provider not registered in registry", async () => {
    vi.mocked(getProvider).mockReturnValue(null)
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    expect(res.status).toBe(503)
  })

  it("returns 502 when provider.refund() fails", async () => {
    mockProvider.refund.mockResolvedValue({
      ok: false,
      error: "Refund declined",
      failureCode: "insufficient_funds",
    })
    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    const json = await res.json()
    expect(res.status).toBe(502)
    expect(json.error).toMatch(/Refund declined/)
    expect(json.failureCode).toBe("insufficient_funds")
  })

  it("returns 409 when Postgres serialization failure (P2034) is detected", async () => {
    // Prisma wraps PG 40001 as PrismaClientKnownRequestError with code "P2034"
    const p2034 = new Prisma.PrismaClientKnownRequestError(
      "Transaction API error: Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
      { code: "P2034", clientVersion: "5.x" },
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction as any).mockRejectedValueOnce(p2034)

    const res = await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/concurrent|retry/i)
  })

  it("wraps aggregate + provider call + DB writes in a single $transaction", async () => {
    await CreateRefund(makeReq("/api/v1/payment-refunds", "POST", validBody))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(vi.mocked(prisma.$transaction as any)).toHaveBeenCalledOnce()
    // Both aggregate and create happen inside the transaction (i.e. on tx = prisma)
    expect(vi.mocked(prisma.paymentRefund.aggregate)).toHaveBeenCalled()
    expect(vi.mocked(prisma.paymentRefund.create)).toHaveBeenCalled()
  })
})

/* ─── GET list ──────────────────────────────────────────────────────── */

describe("GET /api/v1/payment-refunds", () => {
  it("returns list with amounts as numbers", async () => {
    const rows = [{ ...createdRefundRow, id: "ref_1", amount: 40 }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentRefund.findMany).mockResolvedValue(rows as any)

    const res = await ListRefunds(makeReq("/api/v1/payment-refunds"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.refunds).toHaveLength(1)
    expect(json.total).toBe(1)
    expect(typeof json.refunds[0].amount).toBe("number")
    expect(json.refunds[0].amount).toBe(40)
  })

  it("returns 401 when auth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await ListRefunds(makeReq("/api/v1/payment-refunds"))
    expect(res.status).toBe(401)
  })

  it("passes paymentIntentId filter to DB query", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentRefund.findMany).mockResolvedValue([] as any)
    const res = await ListRefunds(makeReq("/api/v1/payment-refunds?paymentIntentId=pi_1"))
    expect(res.status).toBe(200)
    const callArg = vi.mocked(prisma.paymentRefund.findMany).mock.calls[0][0]
    expect(callArg?.where).toMatchObject({ paymentIntentId: "pi_1" })
  })
})

/* ─── GET detail ────────────────────────────────────────────────────── */

describe("GET /api/v1/payment-refunds/[id]", () => {
  it("returns refund with amount as number", async () => {
    vi.mocked(prisma.paymentRefund.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...createdRefundRow, id: "ref_1", amount: 99.5 } as any,
    )

    const res = await GetRefund(
      makeReq("/api/v1/payment-refunds/ref_1"),
      makeParams("ref_1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.refund.id).toBe("ref_1")
    expect(typeof json.refund.amount).toBe("number")
    expect(json.refund.amount).toBe(99.5)
  })

  it("returns 404 for unknown refund", async () => {
    vi.mocked(prisma.paymentRefund.findFirst).mockResolvedValue(null)
    const res = await GetRefund(
      makeReq("/api/v1/payment-refunds/ghost"),
      makeParams("ghost"),
    )
    expect(res.status).toBe(404)
  })
})
