/**
 * D8 Loyalty — preview mirror (Slice 2 Loyalty Builder).
 *
 * Proves the client preview calls the real helpers faithfully AND that ISO
 * string dates from the admin API are re-hydrated to Date before the validity
 * logic runs (the gotcha: a string date silently breaks the expiry check).
 */
import { describe, it, expect } from "vitest"
import { earnPreview, promoPreview, type PreviewEarnRule, type PreviewTier, type PreviewPromoCode } from "@/lib/loyalty/preview"

const RULE: PreviewEarnRule = {
  id: "r-1", name: "1pt/$", trigger: "purchase",
  pointsRate: 1, pointsFlat: null, minOrderAmount: null, productCategory: null,
  priority: 0, applyTierMultiplier: true, isActive: true,
  validFrom: null, validUntil: null, createdAt: "2026-01-01T00:00:00.000Z",
}
const BRONZE_GOLD: PreviewTier[] = [
  { code: "bronze", minLifetimePoints: 0, multiplier: 1 },
  { code: "gold", minLifetimePoints: 1000, multiplier: 2 },
]
const ASOF = new Date("2026-06-20T00:00:00.000Z")

describe("earnPreview", () => {
  it("computes points at each tier via the real engine (1pt/$ x multiplier)", () => {
    const rows = earnPreview([RULE], BRONZE_GOLD, { trigger: "purchase", orderAmount: 100, currency: "USD", asOf: ASOF })
    // bronze sits at 0 → no "no tier" baseline
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tierCode: "bronze", multiplier: 1, award: 100, source: "rate" })
    expect(rows[1]).toMatchObject({ tierCode: "gold", multiplier: 2, award: 200, source: "rate" })
  })

  it("re-hydrates ISO dates: an expired rule (string validUntil) is excluded", () => {
    const expired: PreviewEarnRule = { ...RULE, validUntil: "2020-01-01T00:00:00.000Z" }
    const rows = earnPreview([expired], BRONZE_GOLD, { trigger: "purchase", orderAmount: 100, currency: "USD", asOf: ASOF })
    // every tier earns 0 because the only rule is expired (proves Date compare, not string)
    expect(rows.every((r) => r.award === 0 && r.source === "no_rule")).toBe(true)
  })

  it("emits a 'no tier' baseline when the lowest tier sits above 0", () => {
    const rows = earnPreview([RULE], [{ code: "silver", minLifetimePoints: 500, multiplier: 1.5 }], {
      trigger: "purchase", orderAmount: 100, currency: "USD", asOf: ASOF,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tierCode: null, minLifetimePoints: null, multiplier: 1, award: 100 })
    expect(rows[1]).toMatchObject({ tierCode: "silver", multiplier: 1.5, award: 150 })
  })

  it("with no tiers at all, returns a single baseline row (multiplier 1)", () => {
    const rows = earnPreview([RULE], [], { trigger: "purchase", orderAmount: 100, currency: "USD", asOf: ASOF })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ tierCode: null, multiplier: 1, award: 100 })
  })
})

const PROMO: PreviewPromoCode = {
  id: "p-1", code: "SAVE20", discountType: "percentage", discountValue: 20,
  currency: null, minOrderAmount: null, usageLimit: null, perCustomerLimit: null,
  validFrom: null, validUntil: null, isActive: true,
}

describe("promoPreview", () => {
  it("computes a percentage discount via the real calculator", () => {
    const r = promoPreview(PROMO, { subtotal: 100, currency: "USD", asOf: ASOF })
    expect(r).toMatchObject({ ok: true, amount: 20, capped: false })
  })

  it("re-hydrates ISO dates: an expired code (string validUntil) is rejected as 'expired'", () => {
    const r = promoPreview({ ...PROMO, validUntil: "2020-01-01T00:00:00.000Z" }, { subtotal: 100, currency: "USD", asOf: ASOF })
    expect(r).toMatchObject({ ok: false, reason: "expired" })
  })

  it("surfaces min_order_not_met as the rejection reason", () => {
    const r = promoPreview({ ...PROMO, minOrderAmount: 200 }, { subtotal: 100, currency: "USD", asOf: ASOF })
    expect(r).toMatchObject({ ok: false, reason: "min_order_not_met" })
  })

  it("caps a fixed discount larger than the order at the subtotal (capped=true)", () => {
    const r = promoPreview(
      { ...PROMO, discountType: "fixed", discountValue: 200, currency: "USD" },
      { subtotal: 100, currency: "USD", asOf: ASOF },
    )
    expect(r).toMatchObject({ ok: true, amount: 100, capped: true })
  })
})
