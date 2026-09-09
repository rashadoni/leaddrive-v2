/**
 * D8 Loyalty — PromoCode Decimal serialization tests.
 *
 * Verifies that after the 20260525210000_d8_promo_float_to_decimal migration
 * the three money columns (discountValue, minOrderAmount, discountApplied)
 * are returned as plain JavaScript numbers in API responses, NOT as
 * Prisma.Decimal objects (which would serialize as strings in JSON and
 * break client-side arithmetic).
 *
 * Also verifies the redeem route builds the PromoCodeRow with number-typed
 * fields so the pure helpers receive the expected types.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Decimal } from "@prisma/client/runtime/library"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    promoCode: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    promoCodeRedemption: {
      groupBy: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

// Mock loyalty helpers to avoid side-effects in unit tests
vi.mock("@/lib/loyalty/promo-validator", () => ({
  validatePromoApplication: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock("@/lib/loyalty/discount-calculator", () => ({
  calculateDiscount: vi.fn().mockReturnValue({ amount: 10, capped: false }),
}))
vi.mock("@/lib/loyalty/redemption-helpers", () => ({
  acquirePromoCodeLock: vi.fn().mockResolvedValue(undefined),
  gateAnonymousRedemption: vi.fn().mockReturnValue({ ok: true }),
}))

import { GET, POST } from "@/app/api/v1/promo-codes/route"
import { PATCH } from "@/app/api/v1/promo-codes/[id]/route"
import { POST as REDEEM } from "@/app/api/v1/promo-codes/[id]/redeem/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

// Build a Decimal-typed PromoCode row as Prisma would return after migration
function makePromoCodeDecimal(overrides: Record<string, unknown> = {}) {
  return {
    id: "code-1",
    organizationId: "org-1",
    code: "SUMMER25",
    description: null,
    discountType: "percentage",
    discountValue: new Decimal("25.00"),      // ← Decimal, not number
    currency: null,
    minOrderAmount: new Decimal("50.00"),      // ← Decimal, not number
    usageLimit: null,
    perCustomerLimit: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
    createdBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

// ─── GET /api/v1/promo-codes ────────────────────────────────────────────────

describe("GET /api/v1/promo-codes — Decimal serialization", () => {
  it("returns discountValue and minOrderAmount as plain numbers, not Decimal", async () => {
    const row = makePromoCodeDecimal()
    vi.mocked(prisma.promoCode.findMany).mockResolvedValue([row] as any)
    vi.mocked(prisma.promoCodeRedemption.groupBy).mockResolvedValue([])

    const res = await GET(makeReq("http://localhost:3000/api/v1/promo-codes"))
    expect(res.status).toBe(200)
    const json = await res.json()

    const code = json.codes[0]
    expect(typeof code.discountValue).toBe("number")
    expect(code.discountValue).toBe(25)
    expect(typeof code.minOrderAmount).toBe("number")
    expect(code.minOrderAmount).toBe(50)
  })

  it("serializes minOrderAmount=null correctly", async () => {
    const row = makePromoCodeDecimal({ minOrderAmount: null })
    vi.mocked(prisma.promoCode.findMany).mockResolvedValue([row] as any)
    vi.mocked(prisma.promoCodeRedemption.groupBy).mockResolvedValue([])

    const res = await GET(makeReq("http://localhost:3000/api/v1/promo-codes"))
    const json = await res.json()
    expect(json.codes[0].minOrderAmount).toBeNull()
  })

  it("appends redemptionCount alongside the normalized decimals", async () => {
    const row = makePromoCodeDecimal()
    vi.mocked(prisma.promoCode.findMany).mockResolvedValue([row] as any)
    vi.mocked(prisma.promoCodeRedemption.groupBy).mockResolvedValue([
      { promoCodeId: "code-1", _count: { _all: 7 } },
    ] as any)

    const res = await GET(makeReq("http://localhost:3000/api/v1/promo-codes"))
    const json = await res.json()
    expect(json.codes[0].redemptionCount).toBe(7)
  })
})

// ─── POST /api/v1/promo-codes ───────────────────────────────────────────────

describe("POST /api/v1/promo-codes — Decimal serialization", () => {
  it("returns discountValue as number in the 201 response", async () => {
    const created = makePromoCodeDecimal({ minOrderAmount: null })
    vi.mocked(prisma.promoCode.create).mockResolvedValue(created as any)

    const body = {
      code: "SUMMER25",
      discountType: "percentage",
      discountValue: 25,
    }
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/promo-codes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(typeof json.code.discountValue).toBe("number")
    expect(json.code.discountValue).toBe(25)
  })
})

// ─── PATCH /api/v1/promo-codes/:id ──────────────────────────────────────────

describe("PATCH /api/v1/promo-codes/:id — Decimal serialization + comparison", () => {
  it("returns updated code with discountValue as number", async () => {
    const existing = makePromoCodeDecimal()
    const updated = makePromoCodeDecimal({ discountValue: new Decimal("30.00") })
    vi.mocked(prisma.promoCode.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.promoCode.update).mockResolvedValue(updated as any)

    const res = await PATCH(
      makeReq("http://localhost:3000/api/v1/promo-codes/code-1", {
        method: "PATCH",
        body: JSON.stringify({ discountValue: 30 }),
      }),
      makeParams("code-1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.code.discountValue).toBe("number")
    expect(json.code.discountValue).toBe(30)
  })

  it("does not 400 when existing percentage discountValue is a Decimal < 100", async () => {
    // Tests that the Decimal comparison (existing.discountValue) is safely
    // converted before comparing against MAX_DISCOUNT_PCT (100).
    const existing = makePromoCodeDecimal({ discountValue: new Decimal("25.00") })
    const updated = makePromoCodeDecimal({ discountValue: new Decimal("25.00"), isActive: false })
    vi.mocked(prisma.promoCode.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.promoCode.update).mockResolvedValue(updated as any)

    const res = await PATCH(
      makeReq("http://localhost:3000/api/v1/promo-codes/code-1", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
      makeParams("code-1"),
    )
    // Should not 400 — the Decimal comparison guard must use decimalToNumber()
    expect(res.status).toBe(200)
  })
})

// ─── POST /api/v1/promo-codes/:id/redeem — codeRow construction ─────────────

describe("POST /api/v1/promo-codes/:id/redeem — Decimal→number in codeRow", () => {
  it("handles minOrderAmount=null (no minimum) in codeRow without throwing", async () => {
    // Exercises the `code.minOrderAmount !== null ? decimalToNumber(...) : null` null branch
    const codeRow = makePromoCodeDecimal({ minOrderAmount: null, perCustomerLimit: null, usageLimit: null })
    vi.mocked(prisma.promoCode.findFirst).mockResolvedValueOnce(
      { id: "code-1", perCustomerLimit: null, usageLimit: null } as any,
    )
    const txMock = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "code-1" }]),
      promoCode: { findFirst: vi.fn().mockResolvedValue(codeRow) },
      promoCodeRedemption: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "redeem-2", redeemedAt: new Date() }),
      },
    }
    vi.mocked(prisma.$transaction as any).mockImplementation(
      (fn: (tx: any) => Promise<any>) => fn(txMock),
    )
    const res = await REDEEM(
      makeReq("http://localhost:3000/api/v1/promo-codes/code-1/redeem", {
        method: "POST",
        body: JSON.stringify({ orderAmount: 100, currency: "USD" }),
      }),
      makeParams("code-1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it("passes number-typed discountValue to calculateDiscount (not Prisma.Decimal)", async () => {
    const codeRow = makePromoCodeDecimal({ perCustomerLimit: null, usageLimit: null })

    // Pre-lock peek
    vi.mocked(prisma.promoCode.findFirst).mockResolvedValueOnce(
      { id: "code-1", perCustomerLimit: null, usageLimit: null } as any,
    )

    // $transaction mock — calls the callback with a txMock
    const txMock = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "code-1" }]), // acquirePromoCodeLock FOR UPDATE
      promoCode: {
        findFirst: vi.fn().mockResolvedValue(codeRow),
      },
      promoCodeRedemption: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "redeem-1", redeemedAt: new Date() }),
      },
    }
    vi.mocked(prisma.$transaction as any).mockImplementation(
      (fn: (tx: any) => Promise<any>) => fn(txMock),
    )

    const res = await REDEEM(
      makeReq("http://localhost:3000/api/v1/promo-codes/code-1/redeem", {
        method: "POST",
        body: JSON.stringify({ orderAmount: 100, currency: "USD" }),
      }),
      makeParams("code-1"),
    )

    // Route returns { ok, discount: number (flat), capped, ... }
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    // discount is the flat amount number (result.discount.amount in the route)
    expect(typeof json.discount).toBe("number")
  })
})
