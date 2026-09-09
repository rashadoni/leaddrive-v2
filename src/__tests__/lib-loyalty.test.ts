/**
 * Tests for D8 Promo Codes / Loyalty slice 1 — promo-validator +
 * discount-calculator + points-engine + tier-calculator pure helpers.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import { decimalToNumber, decimalToNumberNullable } from "@/lib/prisma-decimal"
import { validatePromoApplication } from "@/lib/loyalty/promo-validator"
import { calculateDiscount } from "@/lib/loyalty/discount-calculator"
import {
  adjustPoints,
  earnPoints,
  expirePoints,
  redeemPoints,
} from "@/lib/loyalty/points-engine"
import { calculateTier } from "@/lib/loyalty/tier-calculator"
import {
  resolveTierFromList,
  applyTierMultiplier,
  newTierCache,
  loadTiersCached,
} from "@/lib/loyalty/tier-resolver"
import {
  pickEarnRule,
  computeEarnAmount,
  evaluateEarn,
  type EarnRuleRow,
} from "@/lib/loyalty/earn-pipeline"
import {
  gateAnonymousRedemption,
  type PromoCodeLockable,
} from "@/lib/loyalty/redemption-helpers"
import {
  LOYALTY_TRANSACTION_TYPES,
  LOYALTY_TYPE_RULES,
  type LoyaltyTransactionType,
  type PointsBalance,
  type PromoCodeRow,
  type TierDefinition,
} from "@/lib/loyalty/types"

/* ─── validatePromoApplication ────────────────────────────────────────── */

const NOW = new Date("2026-05-17T12:00:00Z")

function makeCode(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: "promo_1",
    code: "SUMMER25",
    discountType: "percentage",
    discountValue: 25,
    currency: null,
    minOrderAmount: null,
    usageLimit: null,
    perCustomerLimit: null,
    validFrom: null,
    validUntil: null,
    isActive: true,
    ...overrides,
  }
}

describe("D8 — validatePromoApplication", () => {
  it("accepts an active code on a valid order with no caps", () => {
    const r = validatePromoApplication({
      code: makeCode(),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects inactive code with reason='inactive'", () => {
    const r = validatePromoApplication({
      code: makeCode({ isActive: false }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("inactive")
  })

  it("rejects code with discountValue=0 as malformed", () => {
    const r = validatePromoApplication({
      code: makeCode({ discountValue: 0 }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("malformed_code")
  })

  it("rejects percentage code with value > 100 as malformed", () => {
    const r = validatePromoApplication({
      code: makeCode({ discountValue: 150 }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("malformed_code")
  })

  it("rejects fixed code with no currency as malformed", () => {
    const r = validatePromoApplication({
      code: makeCode({ discountType: "fixed", discountValue: 10, currency: null }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("malformed_code")
  })

  it("rejects code before validFrom with reason='not_yet_valid'", () => {
    const r = validatePromoApplication({
      code: makeCode({ validFrom: new Date("2026-05-20T00:00:00Z") }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("not_yet_valid")
  })

  it("rejects code after validUntil with reason='expired'", () => {
    const r = validatePromoApplication({
      code: makeCode({ validUntil: new Date("2026-05-01T00:00:00Z") }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("expired")
  })

  it("accepts code AT the validity-window boundaries (inclusive)", () => {
    // At validFrom — inclusive
    const at = validatePromoApplication({
      code: makeCode({ validFrom: NOW, validUntil: NOW }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(at.ok).toBe(true)
  })

  it("rejects fixed-amount code with currency mismatch", () => {
    const r = validatePromoApplication({
      code: makeCode({ discountType: "fixed", discountValue: 10, currency: "USD" }),
      order: { subtotal: 100, currency: "EUR", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("currency_mismatch")
  })

  it("accepts percentage code regardless of order currency (currency-agnostic)", () => {
    for (const currency of ["USD", "EUR", "AZN", "RUB"]) {
      const r = validatePromoApplication({
        code: makeCode(),
        order: { subtotal: 100, currency, contactId: "c_1" },
        counts: { total: 0, byContact: 0 },
        asOf: NOW,
      })
      expect(r.ok).toBe(true)
    }
  })

  it("rejects when subtotal < minOrderAmount", () => {
    const r = validatePromoApplication({
      code: makeCode({ minOrderAmount: 200 }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("min_order_not_met")
  })

  it("accepts when subtotal === minOrderAmount (inclusive)", () => {
    const r = validatePromoApplication({
      code: makeCode({ minOrderAmount: 100 }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects when total usage limit hit", () => {
    const r = validatePromoApplication({
      code: makeCode({ usageLimit: 5 }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 5, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("usage_limit_exceeded")
  })

  it("rejects when per-customer limit hit (with contactId)", () => {
    const r = validatePromoApplication({
      code: makeCode({ perCustomerLimit: 2 }),
      order: { subtotal: 100, currency: "USD", contactId: "c_1" },
      counts: { total: 50, byContact: 2 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("per_customer_limit_exceeded")
  })

  it("anonymous redemption (contactId=null) skips per-customer limit", () => {
    const r = validatePromoApplication({
      code: makeCode({ perCustomerLimit: 2 }),
      order: { subtotal: 100, currency: "USD", contactId: null },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
  })

  it("rejection precedence — inactive trumps everything else", () => {
    // Inactive + expired + currency mismatch — inactive wins.
    const r = validatePromoApplication({
      code: makeCode({
        isActive: false,
        discountType: "fixed",
        discountValue: 10,
        currency: "USD",
        validUntil: new Date("2026-01-01T00:00:00Z"),
      }),
      order: { subtotal: 100, currency: "EUR", contactId: "c_1" },
      counts: { total: 0, byContact: 0 },
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("inactive")
  })
})

/* ─── calculateDiscount ───────────────────────────────────────────────── */

describe("D8 — calculateDiscount", () => {
  it("computes percentage discount on subtotal", () => {
    const r = calculateDiscount({
      code: makeCode({ discountValue: 25 }),
      subtotal: 100,
    })
    expect(r.amount).toBe(25)
    expect(r.capped).toBe(false)
  })

  it("computes fixed discount", () => {
    const r = calculateDiscount({
      code: makeCode({ discountType: "fixed", discountValue: 10, currency: "USD" }),
      subtotal: 100,
    })
    expect(r.amount).toBe(10)
    expect(r.capped).toBe(false)
  })

  it("caps fixed discount at subtotal (never negative total)", () => {
    const r = calculateDiscount({
      code: makeCode({ discountType: "fixed", discountValue: 50, currency: "USD" }),
      subtotal: 30,
    })
    expect(r.amount).toBe(30)
    expect(r.capped).toBe(true)
  })

  it("caps percentage discount AT subtotal when 100% (edge case)", () => {
    const r = calculateDiscount({
      code: makeCode({ discountValue: 100 }),
      subtotal: 50,
    })
    expect(r.amount).toBe(50)
    expect(r.capped).toBe(true)
  })

  it("rounds 2dp on fractional percentage", () => {
    // 33.33% off 100 = 33.33
    const r = calculateDiscount({
      code: makeCode({ discountValue: 33.33 }),
      subtotal: 100,
    })
    expect(r.amount).toBe(33.33)
  })

  it("returns 0 on negative subtotal (defensive)", () => {
    const r = calculateDiscount({
      code: makeCode(),
      subtotal: -10,
    })
    expect(r.amount).toBe(0)
  })

  it("returns 0 on NaN subtotal (defensive)", () => {
    const r = calculateDiscount({
      code: makeCode(),
      subtotal: Number.NaN,
    })
    expect(r.amount).toBe(0)
  })

  it("floors sub-cent subtotal before cap (100% × 50.005 → 50.00, NOT 50.01)", () => {
    // Architect P3 closure: a caller-supplied subtotal with sub-cent
    // precision (50.005) would naively round to 50.01 and the cap
    // branch would return 50.01 — > actual tendered. Floor-before-cap
    // pins the discount at 50.00.
    const r = calculateDiscount({
      code: makeCode({ discountValue: 100 }),
      subtotal: 50.005,
    })
    expect(r.amount).toBe(50)
    expect(r.capped).toBe(true)
  })

  it("floors fixed-amount discount cap on fractional subtotal", () => {
    // Fixed $20 off a $19.999 order → cap at floor(19.999)=19.99.
    const r = calculateDiscount({
      code: makeCode({ discountType: "fixed", discountValue: 20, currency: "USD" }),
      subtotal: 19.999,
    })
    expect(r.amount).toBe(19.99)
    expect(r.capped).toBe(true)
  })
})

/* ─── points-engine: earn ─────────────────────────────────────────────── */

const BAL: PointsBalance = { points: 100, lifetimePoints: 500 }

describe("D8 — earnPoints", () => {
  it("adds to BOTH points and lifetimePoints by default", () => {
    const r = earnPoints({ current: BAL, points: 50 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.points).toBe(150)
      expect(r.next.lifetimePoints).toBe(550)
      expect(r.type).toBe("earn")
      expect(r.delta).toBe(50)
      expect(r.lifetimeDelta).toBe(50)
    }
  })

  it("honours lifetimePoints override (partial-vesting earn)", () => {
    const r = earnPoints({ current: BAL, points: 50, lifetimePoints: 20 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.points).toBe(150)
      expect(r.next.lifetimePoints).toBe(520)
      expect(r.lifetimeDelta).toBe(20)
    }
  })

  it("rejects lifetimePoints override > points (would over-credit lifetime)", () => {
    const r = earnPoints({ current: BAL, points: 50, lifetimePoints: 100 })
    expect(r.ok).toBe(false)
  })

  it("rejects lifetimePoints=0 (DB CHECK requires > 0 for type='earn')", () => {
    const r = earnPoints({ current: BAL, points: 50, lifetimePoints: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/lifetimeContribution=0/i)
  })

  it("rejects zero or negative points", () => {
    expect(earnPoints({ current: BAL, points: 0 }).ok).toBe(false)
    expect(earnPoints({ current: BAL, points: -10 }).ok).toBe(false)
  })

  it("rejects non-integer points", () => {
    expect(earnPoints({ current: BAL, points: 1.5 }).ok).toBe(false)
  })

  it("rejects on corrupted balance (lifetime < points)", () => {
    const r = earnPoints({ current: { points: 100, lifetimePoints: 50 }, points: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/corrupted/)
  })
})

/* ─── points-engine: redeem ───────────────────────────────────────────── */

describe("D8 — redeemPoints", () => {
  it("subtracts from points only — lifetime UNCHANGED", () => {
    const r = redeemPoints({ current: BAL, points: 30 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.points).toBe(70)
      expect(r.next.lifetimePoints).toBe(500) // unchanged
      expect(r.type).toBe("redeem")
      expect(r.delta).toBe(-30)
      expect(r.lifetimeDelta).toBe(0)
    }
  })

  it("can redeem exactly all available", () => {
    const r = redeemPoints({ current: BAL, points: 100 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.next.points).toBe(0)
  })

  it("rejects redeem exceeding balance", () => {
    const r = redeemPoints({ current: BAL, points: 101 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/only 100/)
  })

  it("rejects zero / negative / non-integer", () => {
    for (const p of [0, -1, 1.5]) {
      expect(redeemPoints({ current: BAL, points: p }).ok).toBe(false)
    }
  })
})

/* ─── points-engine: expire ───────────────────────────────────────────── */

describe("D8 — expirePoints", () => {
  it("subtracts from points only — lifetime UNCHANGED", () => {
    const r = expirePoints({ current: BAL, points: 20 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next.points).toBe(80)
      expect(r.next.lifetimePoints).toBe(500)
      expect(r.type).toBe("expire")
      expect(r.delta).toBe(-20)
      expect(r.lifetimeDelta).toBe(0)
    }
  })

  it("rejects expiring more than balance", () => {
    expect(expirePoints({ current: BAL, points: 200 }).ok).toBe(false)
  })
})

/* ─── points-engine: adjust ───────────────────────────────────────────── */

describe("D8 — adjustPoints", () => {
  it("positive delta emits adjustment_credit", () => {
    const r = adjustPoints({ current: BAL, delta: 25 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.type).toBe("adjustment_credit")
      expect(r.next.points).toBe(125)
      expect(r.next.lifetimePoints).toBe(500) // NEVER touch lifetime
      expect(r.lifetimeDelta).toBe(0)
    }
  })

  it("negative delta emits adjustment_debit", () => {
    const r = adjustPoints({ current: BAL, delta: -25 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.type).toBe("adjustment_debit")
      expect(r.next.points).toBe(75)
      expect(r.next.lifetimePoints).toBe(500)
      expect(r.delta).toBe(-25)
    }
  })

  it("rejects zero delta (no-op audit row)", () => {
    expect(adjustPoints({ current: BAL, delta: 0 }).ok).toBe(false)
  })

  it("rejects debit exceeding balance", () => {
    expect(adjustPoints({ current: BAL, delta: -200 }).ok).toBe(false)
  })

  it("rejects non-integer delta", () => {
    expect(adjustPoints({ current: BAL, delta: 1.5 }).ok).toBe(false)
  })
})

/* ─── points-engine: invariant sweep ──────────────────────────────────── */

describe("D8 — points-engine invariants", () => {
  it("redeem followed by earn-equal restores points but lifetimePoints DRIFTS UP", () => {
    // Net-zero balance change, but lifetime should INCREASE because
    // earn always adds to lifetime, redeem never decrements.
    const r1 = redeemPoints({ current: BAL, points: 30 })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = earnPoints({ current: r1.next, points: 30 })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.next.points).toBe(BAL.points) // 100
    expect(r2.next.lifetimePoints).toBe(BAL.lifetimePoints + 30) // 530, NOT 500
  })

  it("LOYALTY_TYPE_RULES has a rule for every LOYALTY_TRANSACTION_TYPES entry (drift guard)", () => {
    for (const t of LOYALTY_TRANSACTION_TYPES) {
      expect(LOYALTY_TYPE_RULES[t as LoyaltyTransactionType]).toBeDefined()
    }
    expect(Object.keys(LOYALTY_TYPE_RULES).sort()).toEqual(
      [...LOYALTY_TRANSACTION_TYPES].sort()
    )
  })

  it("only `earn` rule has touchesLifetime=true", () => {
    for (const t of LOYALTY_TRANSACTION_TYPES) {
      const rule = LOYALTY_TYPE_RULES[t as LoyaltyTransactionType]
      expect(rule.touchesLifetime).toBe(t === "earn")
    }
  })
})

/* ─── tier-calculator ─────────────────────────────────────────────────── */

const TIERS: TierDefinition[] = [
  { code: "bronze", minLifetimePoints: 0 },
  { code: "silver", minLifetimePoints: 500 },
  { code: "gold", minLifetimePoints: 5000 },
]

describe("D8 — calculateTier", () => {
  it("resolves the highest matching tier", () => {
    const r = calculateTier({ tiers: TIERS, lifetimePoints: 700 })
    expect(r.kind).toBe("tier")
    if (r.kind === "tier") expect(r.code).toBe("silver")
  })

  it("resolves AT threshold (inclusive)", () => {
    const r = calculateTier({ tiers: TIERS, lifetimePoints: 500 })
    expect(r.kind).toBe("tier")
    if (r.kind === "tier") expect(r.code).toBe("silver")
  })

  it("resolves to lowest tier when lifetime >= min of lowest", () => {
    const r = calculateTier({ tiers: TIERS, lifetimePoints: 50 })
    expect(r.kind).toBe("tier")
    if (r.kind === "tier") expect(r.code).toBe("bronze")
  })

  it("resolves to highest tier when lifetime >> all thresholds", () => {
    const r = calculateTier({ tiers: TIERS, lifetimePoints: 100_000 })
    expect(r.kind).toBe("tier")
    if (r.kind === "tier") expect(r.code).toBe("gold")
  })

  it("returns 'none' when lifetime below every tier's threshold", () => {
    const r = calculateTier({
      tiers: [{ code: "silver", minLifetimePoints: 500 }],
      lifetimePoints: 100,
    })
    expect(r.kind).toBe("none")
  })

  it("returns 'none' on empty tier list", () => {
    const r = calculateTier({ tiers: [], lifetimePoints: 1000 })
    expect(r.kind).toBe("none")
  })

  it("returns 'none' on negative lifetimePoints (defensive)", () => {
    const r = calculateTier({ tiers: TIERS, lifetimePoints: -1 })
    expect(r.kind).toBe("none")
  })

  it("returns 'none' on non-integer lifetimePoints", () => {
    const r = calculateTier({ tiers: TIERS, lifetimePoints: 1.5 })
    expect(r.kind).toBe("none")
  })

  it("returns 'none' when a tier has invalid minLifetimePoints", () => {
    const r = calculateTier({
      tiers: [{ code: "bad", minLifetimePoints: -1 }],
      lifetimePoints: 100,
    })
    expect(r.kind).toBe("none")
  })

  it("handles unsorted tier list correctly (helper sorts internally)", () => {
    // Provide tiers in reverse order — should still resolve correctly.
    const reversed = [...TIERS].reverse()
    const r = calculateTier({ tiers: reversed, lifetimePoints: 700 })
    expect(r.kind).toBe("tier")
    if (r.kind === "tier") expect(r.code).toBe("silver")
  })

  it("deterministic tie-break: duplicate thresholds → lexicographically last code wins", () => {
    // Two tiers at threshold 100: "alpha" and "zebra". After sorting,
    // zebra comes after alpha; the walk-reverse picks zebra first.
    const r = calculateTier({
      tiers: [
        { code: "alpha", minLifetimePoints: 100 },
        { code: "zebra", minLifetimePoints: 100 },
      ],
      lifetimePoints: 200,
    })
    expect(r.kind).toBe("tier")
    if (r.kind === "tier") expect(r.code).toBe("zebra")
  })
})

/* ─── Phase C — tier-resolver (DB-backed resolution + Math.floor) ─────── */

describe("D8 Phase C — tier-resolver", () => {
  const ACTIVE_TIERS = [
    { code: "bronze",   minLifetimePoints: 0,      multiplier: 1.0 },
    { code: "silver",   minLifetimePoints: 1000,   multiplier: 1.1 },
    { code: "gold",     minLifetimePoints: 10_000, multiplier: 1.25 },
    { code: "platinum", minLifetimePoints: 50_000, multiplier: 1.5 },
    { code: "diamond",  minLifetimePoints: 250_000, multiplier: 2.0 },
  ]

  describe("resolveTierFromList", () => {
    it("returns {tier:null, multiplier:1.0} on empty tier list", () => {
      expect(resolveTierFromList([], 5000)).toEqual({ tier: null, multiplier: 1.0 })
    })

    it("picks bronze (lowest threshold) for 0 lifetime points", () => {
      expect(resolveTierFromList(ACTIVE_TIERS, 0)).toEqual({
        tier: "bronze",
        multiplier: 1.0,
      })
    })

    it("picks silver (1.1x) at exactly the threshold", () => {
      expect(resolveTierFromList(ACTIVE_TIERS, 1000)).toEqual({
        tier: "silver",
        multiplier: 1.1,
      })
    })

    it("picks gold (1.25x) at 25,000 points", () => {
      expect(resolveTierFromList(ACTIVE_TIERS, 25_000)).toEqual({
        tier: "gold",
        multiplier: 1.25,
      })
    })

    it("picks diamond (2.0x) at 1M points", () => {
      expect(resolveTierFromList(ACTIVE_TIERS, 1_000_000)).toEqual({
        tier: "diamond",
        multiplier: 2.0,
      })
    })

    it("returns null when lifetimePoints below every threshold (e.g. no bronze)", () => {
      const noBronze = ACTIVE_TIERS.filter((t) => t.code !== "bronze")
      expect(resolveTierFromList(noBronze, 500)).toEqual({
        tier: null,
        multiplier: 1.0,
      })
    })
  })

  describe("applyTierMultiplier", () => {
    it("returns basePoints unchanged when multiplier is exactly 1.0", () => {
      expect(applyTierMultiplier(99, 1.0)).toBe(99)
    })

    it("Math.floors a 1.5× boost (the 99→148 canonical case)", () => {
      // 99 * 1.5 = 148.5 → floor = 148 (NOT 149 from round)
      expect(applyTierMultiplier(99, 1.5)).toBe(148)
    })

    it("Math.floors a 1.25× boost", () => {
      // 100 * 1.25 = 125 → floor = 125 (no rounding needed)
      expect(applyTierMultiplier(100, 1.25)).toBe(125)
      // 101 * 1.25 = 126.25 → floor = 126
      expect(applyTierMultiplier(101, 1.25)).toBe(126)
    })

    it("Math.floors a 1.1× boost on small values", () => {
      // 7 * 1.1 = 7.7 → floor = 7
      expect(applyTierMultiplier(7, 1.1)).toBe(7)
      // 10 * 1.1 = 11 → floor = 11
      expect(applyTierMultiplier(10, 1.1)).toBe(11)
    })

    it("returns 0 on multiplier <= 0 (defensive guard)", () => {
      expect(applyTierMultiplier(100, 0)).toBe(0)
      expect(applyTierMultiplier(100, -1)).toBe(0)
    })

    it("returns 0 on non-finite multiplier (defensive)", () => {
      expect(applyTierMultiplier(100, NaN)).toBe(0)
      expect(applyTierMultiplier(100, Infinity)).toBe(0)
    })

    it("doubles cleanly at 2.0×", () => {
      expect(applyTierMultiplier(50, 2.0)).toBe(100)
    })
  })

  describe("loadTiersCached", () => {
    it("hits DB once per orgId then serves from cache", async () => {
      let calls = 0
      const fakeClient = {
        loyaltyTier: {
          findMany: async () => {
            calls += 1
            return [{ code: "bronze", minLifetimePoints: 0, multiplier: 1.0 }]
          },
        },
      }
      const cache = newTierCache()
      const a = await loadTiersCached(cache, fakeClient, "org_a")
      const b = await loadTiersCached(cache, fakeClient, "org_a")
      expect(calls).toBe(1)
      expect(a).toEqual(b)
    })

    it("separate orgs each hit DB once", async () => {
      let calls = 0
      const fakeClient = {
        loyaltyTier: {
          findMany: async () => {
            calls += 1
            return []
          },
        },
      }
      const cache = newTierCache()
      await loadTiersCached(cache, fakeClient, "org_a")
      await loadTiersCached(cache, fakeClient, "org_b")
      expect(calls).toBe(2)
    })
  })
})

/* ─── Decimal boundary helpers (D5+D8 migration) ────────────────────── */

describe("prisma-decimal boundary helpers", () => {
  /** Minimal Prisma.Decimal-like object returned at runtime after schema migration. */
  const makeDecimal = (v: number) => ({
    toNumber: () => v,
    toString: () => String(v),
  })

  describe("decimalToNumber", () => {
    it("converts a Decimal-like object via toNumber()", () => {
      expect(decimalToNumber(makeDecimal(1.5))).toBe(1.5)
      expect(decimalToNumber(makeDecimal(1.0))).toBe(1.0)
      expect(decimalToNumber(makeDecimal(0))).toBe(0)
    })

    it("passes through plain numbers unchanged", () => {
      expect(decimalToNumber(1.25)).toBe(1.25)
      expect(decimalToNumber(0)).toBe(0)
    })

    it("returns 0 for null / undefined", () => {
      expect(decimalToNumber(null)).toBe(0)
      expect(decimalToNumber(undefined)).toBe(0)
    })

    it("coerces numeric strings via Number()", () => {
      expect(decimalToNumber("1.5")).toBe(1.5)
    })
  })

  describe("decimalToNumberNullable", () => {
    it("converts a Decimal-like object via toNumber()", () => {
      expect(decimalToNumberNullable(makeDecimal(0.5))).toBe(0.5)
    })

    it("returns null for null / undefined", () => {
      expect(decimalToNumberNullable(null)).toBeNull()
      expect(decimalToNumberNullable(undefined)).toBeNull()
    })

    it("passes through plain number", () => {
      expect(decimalToNumberNullable(42)).toBe(42)
    })
  })

  describe("loadActiveTiers — Decimal multiplier conversion", () => {
    it("converts Decimal multipliers to plain numbers before returning ActiveTierRow[]", async () => {
      const fakeClient = {
        loyaltyTier: {
          findMany: async (): Promise<
            Array<{
              code: string
              minLifetimePoints: number
              multiplier: number | { toNumber(): number; toString(): string }
            }>
          > => [
            { code: "silver",   minLifetimePoints: 1000,  multiplier: makeDecimal(1.1) },
            { code: "gold",     minLifetimePoints: 10_000, multiplier: makeDecimal(1.25) },
          ],
        },
      }
      const { loadActiveTiers } = await import("@/lib/loyalty/tier-resolver")
      const rows = await loadActiveTiers(fakeClient as Parameters<typeof loadActiveTiers>[0], "org_1")
      expect(typeof rows[0].multiplier).toBe("number")
      expect(rows[0].multiplier).toBe(1.1)
      expect(rows[1].multiplier).toBe(1.25)
      // Critical: Number.isFinite must pass after conversion
      expect(Number.isFinite(rows[0].multiplier)).toBe(true)
    })
  })
})

/* ─── Phase D — earn-pipeline (rule selection + award computation) ─── */

describe("D8 Phase D — earn-pipeline", () => {
  const NOW_D = new Date("2026-05-21T12:00:00Z")

  function makeRule(overrides: Partial<EarnRuleRow> = {}): EarnRuleRow {
    return {
      id: "rule_purchase_default",
      name: "Standard purchase",
      trigger: "purchase",
      pointsRate: 1, // 1 point per currency unit
      pointsFlat: null,
      minOrderAmount: null,
      productCategory: null,
      priority: 0,
      applyTierMultiplier: true,
      isActive: true,
      validFrom: null,
      validUntil: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    }
  }

  describe("pickEarnRule", () => {
    it("returns null on empty rule list", () => {
      const r = pickEarnRule([], {
        trigger: "purchase",
        orderAmount: 100,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      expect(r).toBeNull()
    })

    it("returns null when trigger doesn't match any rule", () => {
      const r = pickEarnRule([makeRule({ trigger: "signup" })], {
        trigger: "purchase",
        orderAmount: 100,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      expect(r).toBeNull()
    })

    it("skips inactive rules", () => {
      const r = pickEarnRule([makeRule({ isActive: false })], {
        trigger: "purchase",
        orderAmount: 100,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      expect(r).toBeNull()
    })

    it("skips rules outside the validity window", () => {
      const r = pickEarnRule(
        [
          makeRule({
            validFrom: new Date("2026-06-01T00:00:00Z"),
            validUntil: new Date("2026-12-31T00:00:00Z"),
          }),
        ],
        {
          trigger: "purchase",
          orderAmount: 100,
          currency: "USD",
          productCategory: null,
          asOf: NOW_D,
        },
      )
      expect(r).toBeNull()
    })

    it("skips rules below minOrderAmount", () => {
      const r = pickEarnRule([makeRule({ minOrderAmount: 50 })], {
        trigger: "purchase",
        orderAmount: 25,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      expect(r).toBeNull()
    })

    it("respects productCategory filter when set", () => {
      const rules = [
        makeRule({ id: "r_electronics", productCategory: "electronics", priority: 10 }),
      ]
      // Mismatch — no rule fires.
      expect(
        pickEarnRule(rules, {
          trigger: "purchase",
          orderAmount: 100,
          currency: "USD",
          productCategory: "books",
          asOf: NOW_D,
        }),
      ).toBeNull()
      // Match — rule fires.
      expect(
        pickEarnRule(rules, {
          trigger: "purchase",
          orderAmount: 100,
          currency: "USD",
          productCategory: "electronics",
          asOf: NOW_D,
        })?.id,
      ).toBe("r_electronics")
    })

    it("rule with no productCategory matches ANY category", () => {
      const r = pickEarnRule([makeRule({ productCategory: null })], {
        trigger: "purchase",
        orderAmount: 100,
        currency: "USD",
        productCategory: "books",
        asOf: NOW_D,
      })
      expect(r).not.toBeNull()
    })

    it("picks highest-priority rule when multiple match", () => {
      const rules = [
        makeRule({ id: "r_low", priority: 0 }),
        makeRule({ id: "r_high", priority: 10 }),
        makeRule({ id: "r_mid", priority: 5 }),
      ]
      const r = pickEarnRule(rules, {
        trigger: "purchase",
        orderAmount: 100,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      expect(r?.id).toBe("r_high")
    })

    it("breaks priority ties by createdAt ASC (older wins — matches admin GET ordering)", () => {
      const rules = [
        makeRule({
          id: "r_new",
          priority: 5,
          createdAt: new Date("2026-04-01T00:00:00Z"),
        }),
        makeRule({
          id: "r_old",
          priority: 5,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        }),
      ]
      const r = pickEarnRule(rules, {
        trigger: "purchase",
        orderAmount: 100,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      expect(r?.id).toBe("r_old")
    })

    it("rate rule on a $0.50 order with 1pt/$ is skipped (would award 0)", () => {
      const r = pickEarnRule([makeRule({ pointsRate: 1 })], {
        trigger: "purchase",
        orderAmount: 0.5,
        currency: "USD",
        productCategory: null,
        asOf: NOW_D,
      })
      // 0.5 * 1 = 0.5 → floor = 0; rule skipped, no winner.
      expect(r).toBeNull()
    })

    it("flat rule fires even on $0 order (signup bonus path)", () => {
      const r = pickEarnRule(
        [
          makeRule({
            trigger: "signup",
            pointsRate: null,
            pointsFlat: 500,
          }),
        ],
        {
          trigger: "signup",
          orderAmount: 0,
          currency: "USD",
          productCategory: null,
          asOf: NOW_D,
        },
      )
      expect(r).not.toBeNull()
      expect(r?.pointsFlat).toBe(500)
    })
  })

  describe("computeEarnAmount", () => {
    it("flat rule: returns pointsFlat × multiplier (Math.floor)", () => {
      const rule = makeRule({ pointsRate: null, pointsFlat: 500 })
      // 500 × 1.5 = 750 (no rounding needed)
      expect(
        computeEarnAmount(rule, {
          trigger: "purchase",
          orderAmount: 100,
          currency: "USD",
          productCategory: null,
        }, 1.5),
      ).toEqual({
        award: 750,
        base: 500,
        source: "flat",
        appliedMultiplier: 1.5,
      })
    })

    it("rate rule on $9.99: base = floor(9.99) = 9, gold ×1.25 = floor(11.25) = 11", () => {
      const rule = makeRule({ pointsRate: 1 })
      expect(
        computeEarnAmount(
          rule,
          {
            trigger: "purchase",
            orderAmount: 9.99,
            currency: "USD",
            productCategory: null,
          },
          1.25,
        ),
      ).toEqual({
        award: 11,
        base: 9,
        source: "rate",
        appliedMultiplier: 1.25,
      })
    })

    it("rate rule with applyTierMultiplier=false: tier ignored", () => {
      const rule = makeRule({
        pointsRate: 1,
        applyTierMultiplier: false,
      })
      expect(
        computeEarnAmount(
          rule,
          {
            trigger: "purchase",
            orderAmount: 100,
            currency: "USD",
            productCategory: null,
          },
          2.0, // ignored
        ),
      ).toEqual({
        award: 100,
        base: 100,
        source: "rate",
        appliedMultiplier: 1.0,
      })
    })

    it("both flat and rate set: flat wins (mirrors DB CHECK + migration docs)", () => {
      const rule = makeRule({ pointsRate: 1, pointsFlat: 500 })
      const r = computeEarnAmount(
        rule,
        {
          trigger: "purchase",
          orderAmount: 100,
          currency: "USD",
          productCategory: null,
        },
        1.0,
      )
      expect(r.source).toBe("flat")
      expect(r.base).toBe(500)
    })

    it("zero-order rate rule: award = 0", () => {
      const rule = makeRule({ pointsRate: 1 })
      const r = computeEarnAmount(
        rule,
        {
          trigger: "purchase",
          orderAmount: 0,
          currency: "USD",
          productCategory: null,
        },
        1.5,
      )
      expect(r.award).toBe(0)
    })
  })

  describe("evaluateEarn", () => {
    it("end-to-end: picks rule, computes award with tier multiplier", () => {
      const rules = [makeRule({ pointsRate: 1, priority: 0 })]
      const r = evaluateEarn(
        rules,
        {
          trigger: "purchase",
          orderAmount: 50,
          currency: "USD",
          productCategory: null,
          asOf: NOW_D,
        },
        1.5, // silver
      )
      // base = floor(50 * 1) = 50; award = floor(50 * 1.5) = 75
      expect(r.award).toBe(75)
      expect(r.base).toBe(50)
      expect(r.source).toBe("rate")
      expect(r.appliedMultiplier).toBe(1.5)
      expect(r.rule).not.toBeNull()
    })

    it("returns no_rule when nothing matches", () => {
      const r = evaluateEarn(
        [makeRule({ trigger: "signup" })],
        {
          trigger: "purchase",
          orderAmount: 100,
          currency: "USD",
          productCategory: null,
          asOf: NOW_D,
        },
        1.0,
      )
      expect(r).toEqual({
        rule: null,
        award: 0,
        base: 0,
        source: "no_rule",
        appliedMultiplier: 1.0,
      })
    })

    it("composes higher-priority flat rule over lower-priority rate rule", () => {
      const rules = [
        makeRule({
          id: "r_rate",
          pointsRate: 1,
          pointsFlat: null,
          priority: 0,
        }),
        makeRule({
          id: "r_flat",
          pointsRate: null,
          pointsFlat: 1000,
          priority: 10,
          applyTierMultiplier: false,
        }),
      ]
      const r = evaluateEarn(
        rules,
        {
          trigger: "purchase",
          orderAmount: 50,
          currency: "USD",
          productCategory: null,
          asOf: NOW_D,
        },
        2.0,
      )
      expect(r.rule?.id).toBe("r_flat")
      expect(r.award).toBe(1000) // flat 1000, no tier multiplier
    })
  })
})

/* ─── Phase D — redemption-helpers (anonymous-fraud gate) ───────────── */

describe("D8 Phase D — redemption-helpers", () => {
  function makeLockable(
    overrides: Partial<PromoCodeLockable> = {},
  ): PromoCodeLockable {
    return {
      id: "promo_1",
      perCustomerLimit: null,
      usageLimit: null,
      ...overrides,
    }
  }

  describe("gateAnonymousRedemption", () => {
    it("identified caller always passes (gate doesn't apply)", () => {
      expect(
        gateAnonymousRedemption(makeLockable({ perCustomerLimit: 1 }), "c_123"),
      ).toEqual({ ok: true })
    })

    it("anonymous + no per-customer cap → passes", () => {
      expect(
        gateAnonymousRedemption(makeLockable({ perCustomerLimit: null }), null),
      ).toEqual({ ok: true })
    })

    it("anonymous + per-customer cap → refused with reason", () => {
      const r = gateAnonymousRedemption(
        makeLockable({ perCustomerLimit: 1 }),
        null,
      )
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reason).toBe("per_customer_limit_requires_identity")
      }
    })

    it("empty-string contactId treated as anonymous", () => {
      const r = gateAnonymousRedemption(
        makeLockable({ perCustomerLimit: 5 }),
        "",
      )
      expect(r.ok).toBe(false)
    })

    it("anonymous + per-customer cap (global cap present too) → still refused", () => {
      const r = gateAnonymousRedemption(
        makeLockable({ perCustomerLimit: 1, usageLimit: 100 }),
        null,
      )
      expect(r.ok).toBe(false)
    })
  })
})
