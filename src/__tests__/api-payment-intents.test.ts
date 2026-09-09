/**
 * Tests for D5 Payments — /api/v1/payment-intents routes.
 *
 * Covers:
 *   GET  /api/v1/payment-intents         — list with status/providerId filter
 *   POST /api/v1/payment-intents         — create: validation, provider lookup,
 *     provider stub call, Decimal→number normalization on response
 *   GET  /api/v1/payment-intents/[id]    — detail with refunds, amount as number
 *   PATCH /api/v1/payment-intents/[id]   — status transition via real SM
 *     (advanceIntentState used as-is via importOriginal — pure function, already
 *     unit-tested in lib-payments.test.ts)
 *
 * No real DB — prisma fully mocked.
 * getProvider is mocked; advanceIntentState uses the real SM implementation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/* ─── Mocks ─────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentProvider: {
      findFirst: vi.fn(),
    },
    paymentIntent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

// Mock only getProvider — let advanceIntentState / PAYMENT_INTENT_STATUSES
// come from the real module so SM behaviour is exercised in PATCH tests.
vi.mock("@/lib/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments")>()
  return { ...actual, getProvider: vi.fn() }
})

import { GET as ListIntents, POST as CreateIntent } from "@/app/api/v1/payment-intents/route"
import {
  GET as GetIntent,
  PATCH as UpdateIntentStatus,
} from "@/app/api/v1/payment-intents/[id]/route"
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

// Minimal provider stub — createIntent succeeds by default
const mockProvider = {
  type: "stripe" as const,
  isConfigured: vi.fn(() => true),
  createIntent: vi.fn().mockResolvedValue({
    ok: true,
    externalRef: "pi_stub_test123",
    clientSecret: "pi_stub_secret_abc",
    status: "pending",
  }),
  refund: vi.fn(),
  parseWebhook: vi.fn(),
}

// Provider DB row
const providerRow = {
  id: "prov_1",
  type: "stripe",
  isActive: true,
  isTestMode: true,
  credentials: { secretKey: "sk_test_abc" },
}

// Created intent row returned by prisma.paymentIntent.create mock
const createdIntentRow = {
  id: "pi_new",
  organizationId: "org_1",
  providerId: "prov_1",
  externalRef: "pi_stub_test123",
  amount: 49.99,
  currency: "USD",
  status: "pending",
  description: null,
  customerEmail: null,
  contactId: null,
  subscriptionId: null,
  invoiceId: null,
  paymentMethod: null,
  metadata: {},
  failureCode: null,
  failureMessage: null,
  succeededAt: null,
  failedAt: null,
  cancelledAt: null,
  createdBy: "user_1",
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getProvider).mockReturnValue(mockProvider as any)
  mockProvider.createIntent.mockResolvedValue({
    ok: true,
    externalRef: "pi_stub_test123",
    clientSecret: "pi_stub_secret_abc",
    status: "pending",
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(providerRow as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.paymentIntent.create).mockResolvedValue(createdIntentRow as any)
})

/* ─── GET list ──────────────────────────────────────────────────────── */

describe("GET /api/v1/payment-intents", () => {
  it("returns list with amounts as numbers", async () => {
    const rows = [{ ...createdIntentRow, id: "pi_1", amount: 49.99 }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentIntent.findMany).mockResolvedValue(rows as any)

    const res = await ListIntents(makeReq("/api/v1/payment-intents"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.intents).toHaveLength(1)
    expect(json.total).toBe(1)
    expect(typeof json.intents[0].amount).toBe("number")
    expect(json.intents[0].amount).toBe(49.99)
  })

  it("returns 401 when auth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await ListIntents(makeReq("/api/v1/payment-intents"))
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid status filter", async () => {
    const res = await ListIntents(makeReq("/api/v1/payment-intents?status=unicorn"))
    expect(res.status).toBe(400)
  })

  it("passes valid status filter to DB query", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentIntent.findMany).mockResolvedValue([] as any)
    const res = await ListIntents(makeReq("/api/v1/payment-intents?status=succeeded"))
    expect(res.status).toBe(200)
    const callArg = vi.mocked(prisma.paymentIntent.findMany).mock.calls[0][0]
    expect(callArg?.where).toMatchObject({ status: "succeeded" })
  })
})

/* ─── POST create ───────────────────────────────────────────────────── */

describe("POST /api/v1/payment-intents", () => {
  const validBody = { providerId: "prov_1", amount: 49.99, currency: "USD" }

  it("creates intent and returns 201 with clientSecret", async () => {
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.intent.id).toBe("pi_new")
    expect(typeof json.intent.amount).toBe("number")
    expect(json.intent.amount).toBe(49.99)
    expect(json.clientSecret).toBe("pi_stub_secret_abc")
    expect(json.intent.externalRef).toBe("pi_stub_test123")
  })

  it("normalizes currency to uppercase and stores it", async () => {
    const res = await CreateIntent(
      makeReq("/api/v1/payment-intents", "POST", { ...validBody, currency: "usd" }),
    )
    expect(res.status).toBe(201)
    // Verify the DB write used uppercase currency
    const callArg = vi.mocked(prisma.paymentIntent.create).mock.calls[0][0]
    expect(callArg.data.currency).toBe("USD")
  })

  it("returns 400 when providerId is missing", async () => {
    const { providerId: _, ...body } = validBody
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when amount is missing", async () => {
    const { amount: _, ...body } = validBody
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", body))
    expect(res.status).toBe(400)
  })

  it("returns 400 when amount is zero", async () => {
    const res = await CreateIntent(
      makeReq("/api/v1/payment-intents", "POST", { ...validBody, amount: 0 }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when amount is negative", async () => {
    const res = await CreateIntent(
      makeReq("/api/v1/payment-intents", "POST", { ...validBody, amount: -10 }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when amount exceeds maximum", async () => {
    const res = await CreateIntent(
      makeReq("/api/v1/payment-intents", "POST", { ...validBody, amount: 1_000_000_000 }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when currency is not 3 alphabetic chars", async () => {
    for (const bad of ["US", "USDX", "U1D", ""]) {
      const res = await CreateIntent(
        makeReq("/api/v1/payment-intents", "POST", { ...validBody, currency: bad }),
      )
      expect(res.status).toBe(400)
    }
  })

  it("returns 404 when provider not found", async () => {
    vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(null)
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", validBody))
    expect(res.status).toBe(404)
  })

  it("returns 400 when provider is inactive", async () => {
    vi.mocked(prisma.paymentProvider.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...providerRow, isActive: false } as any,
    )
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", validBody))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/disabled/i)
  })

  it("returns 503 when provider not registered in registry", async () => {
    vi.mocked(getProvider).mockReturnValue(null)
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", validBody))
    expect(res.status).toBe(503)
  })

  it("returns 502 when provider stub rejects (createIntent ok: false)", async () => {
    mockProvider.createIntent.mockResolvedValue({
      ok: false,
      error: "Card declined",
      failureCode: "card_declined",
    })
    const res = await CreateIntent(makeReq("/api/v1/payment-intents", "POST", validBody))
    const json = await res.json()
    expect(res.status).toBe(502)
    expect(json.error).toMatch(/Card declined/)
    expect(json.failureCode).toBe("card_declined")
  })
})

/* ─── GET detail ────────────────────────────────────────────────────── */

describe("GET /api/v1/payment-intents/[id]", () => {
  it("returns intent with amount as number and refunds list", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue({
      ...createdIntentRow,
      id: "pi_1",
      amount: 99.5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      refunds: [] as any[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const res = await GetIntent(makeReq("/api/v1/payment-intents/pi_1"), makeParams("pi_1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.intent.id).toBe("pi_1")
    expect(typeof json.intent.amount).toBe("number")
    expect(json.intent.amount).toBe(99.5)
    expect(Array.isArray(json.intent.refunds)).toBe(true)
  })

  it("returns 404 for unknown intent", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(null)
    const res = await GetIntent(makeReq("/api/v1/payment-intents/ghost"), makeParams("ghost"))
    expect(res.status).toBe(404)
  })
})

/* ─── PATCH status transition ───────────────────────────────────────── */

describe("PATCH /api/v1/payment-intents/[id] — status transition", () => {
  const existingPending = { id: "pi_1", organizationId: "org_1", status: "pending" }

  it("transitions pending → processing successfully", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      existingPending as any,
    )
    const updated = { ...createdIntentRow, status: "processing" }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.paymentIntent.update).mockResolvedValue(updated as any)

    const res = await UpdateIntentStatus(
      makeReq("/api/v1/payment-intents/pi_1", "PATCH", { status: "processing" }),
      makeParams("pi_1"),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.intent.status).toBe("processing")
    expect(typeof json.intent.amount).toBe("number")
  })

  it("rejects provider-settled statuses from manual PATCH", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...existingPending, status: "processing" } as any,
    )
    const res = await UpdateIntentStatus(
      makeReq("/api/v1/payment-intents/pi_1", "PATCH", { status: "succeeded" }),
      makeParams("pi_1"),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error).toMatch(/provider-controlled/i)
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled()
  })

  it("rejects refund terminal statuses from manual PATCH", async () => {
    const res = await UpdateIntentStatus(
      makeReq("/api/v1/payment-intents/pi_1", "PATCH", { status: "refunded" }),
      makeParams("pi_1"),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error).toMatch(/provider-controlled/i)
    expect(prisma.paymentIntent.findFirst).not.toHaveBeenCalled()
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled()
  })

  it("returns 400 for unknown target status", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      existingPending as any,
    )
    const res = await UpdateIntentStatus(
      makeReq("/api/v1/payment-intents/pi_1", "PATCH", { status: "unicorn" }),
      makeParams("pi_1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when intent not found", async () => {
    vi.mocked(prisma.paymentIntent.findFirst).mockResolvedValue(null)
    const res = await UpdateIntentStatus(
      makeReq("/api/v1/payment-intents/ghost", "PATCH", { status: "processing" }),
      makeParams("ghost"),
    )
    expect(res.status).toBe(404)
  })
})
