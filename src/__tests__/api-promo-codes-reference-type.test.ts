/**
 * D8 Loyalty slice-2 soft #7 — PromoCodeRedemption.referenceType
 * discriminator route-layer validation.
 *
 * Migration `20260529000000_add_promo_redemption_reference_type` adds
 * a nullable `referenceType` column constrained to
 * `'invoice' | 'order' | 'cart' | NULL`. The DB CHECK is permissive
 * (allows NULL for legacy + truly anonymous rows), but the redeem
 * route enforces an "id requires type, type requires id" pair-rule
 * so slice-3 reporting can join `referenceId` to the right entity
 * table without ambiguity.
 *
 * Tests target the new validation logic added to
 * `src/app/api/v1/promo-codes/[id]/redeem/route.ts`. Pure-helper mocks
 * are reused from the Decimal-serialization test pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Decimal } from "@prisma/client/runtime/library"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    promoCode: {
      findFirst: vi.fn(),
    },
    promoCodeRedemption: {
      count: vi.fn(),
      create: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

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

import { POST as REDEEM } from "@/app/api/v1/promo-codes/[id]/redeem/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin" }

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/promo-codes/code-1/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: "code-1" }) }
}

function makePromoCode() {
  return {
    id: "code-1",
    organizationId: "org-1",
    code: "SUMMER25",
    description: null,
    discountType: "percentage",
    discountValue: new Decimal("25.00"),
    currency: "USD",
    minOrderAmount: null,
    usageLimit: null,
    perCustomerLimit: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue(AUTH)
  ;(prisma.promoCode.findFirst as any).mockResolvedValue(makePromoCode())
  ;(prisma.promoCodeRedemption.count as any).mockResolvedValue(0)
  ;(prisma.promoCodeRedemption.create as any).mockResolvedValue({
    id: "redemption-1",
    redeemedAt: new Date("2026-05-29T00:00:00Z"),
  })
  // The route runs the create inside prisma.$transaction; the mock
  // just invokes the callback with a tx that proxies to prisma itself.
  ;(prisma.$transaction as any).mockImplementation(async (cb: any) => {
    return cb(prisma)
  })
})

describe("PromoCode redeem — referenceType discriminator (D8 soft #7)", () => {
  it("accepts referenceId + referenceType=invoice and persists both", async () => {
    const res = await REDEEM(
      makeReq({
        orderAmount: 100,
        currency: "USD",
        referenceId: "inv-42",
        referenceType: "invoice",
      }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.referenceId).toBe("inv-42")
    expect(json.referenceType).toBe("invoice")
    // The create call must carry both fields through to the DB.
    expect(prisma.promoCodeRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceId: "inv-42",
          referenceType: "invoice",
        }),
      }),
    )
  })

  it("accepts referenceType=order", async () => {
    const res = await REDEEM(
      makeReq({
        orderAmount: 50,
        currency: "USD",
        referenceId: "ord-7",
        referenceType: "order",
      }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).referenceType).toBe("order")
  })

  it("accepts referenceType=cart", async () => {
    const res = await REDEEM(
      makeReq({
        orderAmount: 30,
        currency: "USD",
        referenceId: "cart-3",
        referenceType: "cart",
      }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).referenceType).toBe("cart")
  })

  it("accepts neither (truly anonymous redemption) and writes referenceType=null", async () => {
    const res = await REDEEM(
      makeReq({ orderAmount: 100, currency: "USD" }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.referenceId).toBe(null)
    expect(json.referenceType).toBe(null)
    expect(prisma.promoCodeRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceId: null,
          referenceType: null,
        }),
      }),
    )
  })

  it("rejects referenceId without referenceType (400 — pair-rule)", async () => {
    const res = await REDEEM(
      makeReq({ orderAmount: 100, currency: "USD", referenceId: "inv-1" }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/referenceType.*required.*referenceId/i)
    // The DB write must NOT have happened.
    expect(prisma.promoCodeRedemption.create).not.toHaveBeenCalled()
  })

  it("rejects referenceType without referenceId (400 — pair-rule)", async () => {
    const res = await REDEEM(
      makeReq({ orderAmount: 100, currency: "USD", referenceType: "invoice" }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/referenceType.*requires.*referenceId/i)
    expect(prisma.promoCodeRedemption.create).not.toHaveBeenCalled()
  })

  it("rejects referenceType outside the taxonomy (400)", async () => {
    const res = await REDEEM(
      makeReq({
        orderAmount: 100,
        currency: "USD",
        referenceId: "x-1",
        referenceType: "subscription",
      }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/must be one of.*invoice.*order.*cart/i)
    expect(prisma.promoCodeRedemption.create).not.toHaveBeenCalled()
  })

  it("rejects referenceType as a non-string type (400)", async () => {
    const res = await REDEEM(
      makeReq({
        orderAmount: 100,
        currency: "USD",
        referenceId: "x-1",
        referenceType: 42,
      }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    expect(prisma.promoCodeRedemption.create).not.toHaveBeenCalled()
  })
})
