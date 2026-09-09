/**
 * Tests for G3 Calculated Insights slice 1 — 4 pre-built
 * calculators (LTV / churn-risk / engagement / days-since-last-purchase)
 * + type-registry drift guard. No DB.
 */
import { describe, expect, it } from "vitest"
import { calculateLtv } from "@/lib/calculated-insights/ltv-calculator"
import { calculateChurnRisk } from "@/lib/calculated-insights/churn-risk-calculator"
import { calculateEngagementScore } from "@/lib/calculated-insights/engagement-score-calculator"
import { calculateDaysSinceLastPurchase } from "@/lib/calculated-insights/days-since-last-purchase"
import {
  INSIGHT_VALUE_TYPES,
  PREBUILT_INSIGHT_KEYS,
  PREBUILT_INSIGHT_VALUE_TYPES,
  type CalculatorInput,
  type CalculatorInputInvoice,
  type CalculatorInputProfile,
  type PrebuiltInsightKey,
} from "@/lib/calculated-insights/types"

/* ─── Fixtures ────────────────────────────────────────────────────────── */

const NOW = new Date("2026-05-17T12:00:00Z")

function mkProfile(
  overrides: Partial<CalculatorInputProfile> = {}
): CalculatorInputProfile {
  return {
    totalSpent: 0,
    lifetimeOrderCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    channelsActive: [],
    ...overrides,
  }
}

function inv(paidAt: string, totalAmount: number): CalculatorInputInvoice {
  return { paidAt: new Date(paidAt), totalAmount }
}

function mkInput(
  profile: CalculatorInputProfile,
  invoices: CalculatorInputInvoice[],
  asOf: Date = NOW
): CalculatorInput {
  return { profile, invoices, asOf }
}

/* ─── LTV ─────────────────────────────────────────────────────────────── */

describe("G3 — calculateLtv", () => {
  it("returns value=0, confidence=0 on zero paid invoices", () => {
    const r = calculateLtv(mkInput(mkProfile(), []))
    expect(r.value).toBe(0)
    expect(r.confidence).toBe(0)
    expect(r.metadata.reason).toBe("no_paid_invoices")
  })

  it("emits scaled confidence < 1 with fewer than 3 paid invoices", () => {
    // 2 invoices → confidence = 2/3 ≈ 0.67
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: new Date("2025-11-17T00:00:00Z") }),
        [inv("2026-01-01T00:00:00Z", 100), inv("2026-03-01T00:00:00Z", 200)]
      )
    )
    expect(r.confidence).toBeCloseTo(0.67, 1)
  })

  it("emits confidence=1 with >= 3 paid invoices", () => {
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: new Date("2025-11-17T00:00:00Z") }),
        [
          inv("2026-01-01T00:00:00Z", 100),
          inv("2026-02-01T00:00:00Z", 100),
          inv("2026-03-01T00:00:00Z", 100),
        ]
      )
    )
    expect(r.confidence).toBe(1)
  })

  it("computes historicalLTV = sum of paid amounts", () => {
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: new Date("2025-05-17T00:00:00Z") }),
        [
          inv("2025-06-01T00:00:00Z", 100),
          inv("2025-09-01T00:00:00Z", 200),
          inv("2026-01-01T00:00:00Z", 300),
        ]
      )
    )
    expect(r.metadata.historicalLTV).toBe(600)
  })

  it("projects forward — projectedLTV >= historicalLTV when monthsRemaining > 0", () => {
    // 6 months since first seen, 3 orders ($100 each) → ordersPerMonth = 0.5
    // expectedRemainingMonths = 36 - 6 = 30
    // projectedLTV = 300 + 100 × 0.5 × 30 = 300 + 1500 = 1800
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: new Date("2025-11-17T00:00:00Z") }),
        [
          inv("2026-01-01T00:00:00Z", 100),
          inv("2026-03-01T00:00:00Z", 100),
          inv("2026-05-01T00:00:00Z", 100),
        ]
      )
    )
    expect(r.metadata.historicalLTV).toBe(300)
    expect(r.value).toBeGreaterThan(300) // projected > historical
    expect(r.metadata.projectedLTV).toBe(r.value)
  })

  it("projection collapses to historicalLTV when months since first > expected lifetime", () => {
    // First seen 5 years ago — expectedRemainingMonths = 0 → no projection.
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: new Date("2021-05-17T00:00:00Z") }),
        [
          inv("2021-06-01T00:00:00Z", 100),
          inv("2022-06-01T00:00:00Z", 100),
          inv("2024-06-01T00:00:00Z", 100),
        ]
      )
    )
    expect(r.value).toBe(r.metadata.historicalLTV)
    expect(r.metadata.expectedRemainingMonths).toBe(0)
  })

  it("handles same-day burst (monthsSinceFirstSeen < 1) without divide-by-zero", () => {
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: new Date("2026-05-17T08:00:00Z") }),
        [
          inv("2026-05-17T09:00:00Z", 100),
          inv("2026-05-17T10:00:00Z", 100),
          inv("2026-05-17T11:00:00Z", 100),
        ]
      )
    )
    expect(Number.isFinite(r.value)).toBe(true)
    expect(r.value).toBeGreaterThanOrEqual(300) // at least historical
  })

  it("falls back to first invoice's paidAt when profile.firstSeenAt is null", () => {
    const r = calculateLtv(
      mkInput(
        mkProfile({ firstSeenAt: null }),
        [
          inv("2025-11-17T00:00:00Z", 100), // becomes the "first seen"
          inv("2026-01-17T00:00:00Z", 100),
          inv("2026-03-17T00:00:00Z", 100),
        ]
      )
    )
    // monthsSinceFirstSeen should reflect 6 months, not 0
    expect(r.metadata.monthsSinceFirstSeen).toBeGreaterThanOrEqual(5)
  })

  it("ignores negative / NaN invoice amounts (defensive)", () => {
    const r = calculateLtv(
      mkInput(mkProfile({ firstSeenAt: NOW }), [
        inv("2026-05-01T00:00:00Z", 100),
        inv("2026-05-10T00:00:00Z", -50),
        inv("2026-05-15T00:00:00Z", Number.NaN),
      ])
    )
    // Only the 100 invoice counts.
    expect(r.metadata.historicalLTV).toBe(100)
    expect(r.metadata.paidInvoiceCount).toBe(1)
  })
})

/* ─── Churn risk ──────────────────────────────────────────────────────── */

describe("G3 — calculateChurnRisk", () => {
  it("emits value=0 + confidence=0 with < 2 paid invoices", () => {
    const r = calculateChurnRisk(mkInput(mkProfile(), [inv("2026-05-01T00:00:00Z", 100)]))
    expect(r.value).toBe(0)
    expect(r.confidence).toBe(0)
    expect(r.metadata.reason).toBe("insufficient_data_for_cadence")
  })

  it("low risk when last order is well within average cadence", () => {
    // Orders every ~30 days; last order 10 days ago → risk far below 1.
    const r = calculateChurnRisk(
      mkInput(
        mkProfile(),
        [
          inv("2026-03-07T00:00:00Z", 100), // 71d ago
          inv("2026-04-07T00:00:00Z", 100), // 40d ago
          inv("2026-05-07T00:00:00Z", 100), // 10d ago
        ]
      )
    )
    // avgGap ≈ 30d, daysSinceLast = 10, inflection = 90d → risk ≈ 0.11
    expect(r.value).toBeLessThan(0.2)
    expect(r.confidence).toBe(1)
  })

  it("saturates at 1.0 when daysSinceLast >> 3× avg cadence", () => {
    // avgGap ≈ 7d, daysSinceLast = 90+ → way past 3× inflection → 1.0
    const r = calculateChurnRisk(
      mkInput(
        mkProfile(),
        [
          inv("2026-01-01T00:00:00Z", 100),
          inv("2026-01-08T00:00:00Z", 100),
          inv("2026-01-15T00:00:00Z", 100),
        ]
      )
    )
    expect(r.value).toBe(1)
  })

  it("risk = 0.5 at exactly 1.5× avg cadence (halfway to inflection)", () => {
    // avgGap = 30d, daysSinceLast = 45d → 45 / 90 = 0.5
    const r = calculateChurnRisk(
      mkInput(
        mkProfile(),
        [
          inv("2026-03-03T00:00:00Z", 100), // 30 days before last
          inv("2026-04-02T00:00:00Z", 100), // last order 45d before NOW
        ],
        NOW
      )
    )
    expect(r.value).toBeCloseTo(0.5, 1)
  })

  it("re-sorts unsorted invoices defensively (caller-side regression guard)", () => {
    // Pass DESC order — calculator should still compute correct cadence.
    const r = calculateChurnRisk(
      mkInput(
        mkProfile(),
        [
          inv("2026-05-07T00:00:00Z", 100),
          inv("2026-04-07T00:00:00Z", 100),
          inv("2026-03-07T00:00:00Z", 100),
        ]
      )
    )
    expect(r.confidence).toBe(1)
    expect(r.metadata.averageGapDays).toBeCloseTo(30.5, 0)
  })

  it("handles zero-gap (same-timestamp orders) as zero risk + clear metadata", () => {
    const r = calculateChurnRisk(
      mkInput(mkProfile(), [
        inv("2026-05-17T10:00:00Z", 100),
        inv("2026-05-17T10:00:00Z", 100),
      ])
    )
    expect(r.value).toBe(0)
    expect(r.metadata.reason).toBe("zero_average_gap_treated_as_zero_risk")
  })
})

/* ─── Engagement score ───────────────────────────────────────────────── */

describe("G3 — calculateEngagementScore", () => {
  it("returns 0/0 on completely empty inputs", () => {
    const r = calculateEngagementScore(mkInput(mkProfile(), []))
    expect(r.value).toBe(0)
    expect(r.confidence).toBe(0)
  })

  it("recency saturates score: lastSeen today = max recency credit", () => {
    const r = calculateEngagementScore(
      mkInput(
        mkProfile({
          lastSeenAt: NOW,
          channelsActive: ["contact", "lead", "mtm_customer", "portal_user"],
        }),
        Array.from({ length: 10 }, (_, i) =>
          inv(`2026-0${(i % 9) + 1}-01T00:00:00Z`, 100)
        )
      )
    )
    expect(r.value).toBe(100) // recency=1, frequency=1, breadth=1 → composite=1 → 100
    expect(r.confidence).toBe(1)
  })

  it("recency decays to zero past RECENCY_DECAY_DAYS (90 days)", () => {
    const old = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000)
    const r = calculateEngagementScore(
      mkInput(
        mkProfile({
          lastSeenAt: old,
          channelsActive: ["contact"],
        }),
        []
      )
    )
    // recency=0, frequency=0, breadth=1/4=0.25
    // composite = 0×0.5 + 0×0.3 + 0.25×0.2 = 0.05 → 5
    expect(r.value).toBeCloseTo(5, 0)
  })

  it("partial signals get confidence 0.5", () => {
    // Channels but no invoices.
    const r = calculateEngagementScore(
      mkInput(
        mkProfile({
          lastSeenAt: NOW,
          channelsActive: ["contact"],
        }),
        []
      )
    )
    expect(r.confidence).toBe(0.5)
  })

  it("both signals → confidence 1.0", () => {
    const r = calculateEngagementScore(
      mkInput(
        mkProfile({
          lastSeenAt: NOW,
          channelsActive: ["contact"],
        }),
        [inv("2026-05-01T00:00:00Z", 100)]
      )
    )
    expect(r.confidence).toBe(1)
  })

  it("breadth saturates at 4 channels (room for 5 not to over-credit)", () => {
    const r = calculateEngagementScore(
      mkInput(
        mkProfile({
          lastSeenAt: NOW,
          channelsActive: ["a", "b", "c", "d", "e"], // 5 — saturated
        }),
        []
      )
    )
    // breadth=1.0 (capped); frequency=0; recency=1 → composite = 0.5 + 0 + 0.2 = 0.7 → 70
    expect(r.value).toBe(70)
  })
})

/* ─── Days since last purchase ────────────────────────────────────────── */

describe("G3 — calculateDaysSinceLastPurchase", () => {
  it("returns 0/0 on no paid invoices", () => {
    const r = calculateDaysSinceLastPurchase(mkInput(mkProfile(), []))
    expect(r.value).toBe(0)
    expect(r.confidence).toBe(0)
  })

  it("returns integer days since the most recent paidAt", () => {
    const r = calculateDaysSinceLastPurchase(
      mkInput(
        mkProfile(),
        [inv("2026-04-17T00:00:00Z", 100), inv("2026-05-07T00:00:00Z", 100)]
      )
    )
    // May 17 - May 7 = 10 days exactly
    expect(r.value).toBe(10)
    expect(r.confidence).toBe(1)
  })

  it("picks max paidAt even if invoices are unsorted", () => {
    const r = calculateDaysSinceLastPurchase(
      mkInput(
        mkProfile(),
        [
          inv("2026-05-10T00:00:00Z", 100),
          inv("2026-03-10T00:00:00Z", 100),
          inv("2026-05-15T00:00:00Z", 100),
        ]
      )
    )
    // Latest is May 15 → 2 days
    expect(r.value).toBe(2)
  })

  it("clamps to value=0 + confidence=0 on future paidAt (clock skew exclusion)", () => {
    // Architect-driven fix: confidence=0 (not 1) so downstream
    // segmentation `value > 60 AND confidence > 0.5` correctly EXCLUDES
    // clock-skewed rows instead of silently treating them as
    // "0 days since purchase = very active".
    const r = calculateDaysSinceLastPurchase(
      mkInput(mkProfile(), [inv("2027-01-01T00:00:00Z", 100)])
    )
    expect(r.value).toBe(0)
    expect(r.confidence).toBe(0)
    expect(r.metadata.reason).toBe("future_paid_at_clamped")
  })

  it("ignores negative / NaN amounts (defensive)", () => {
    const r = calculateDaysSinceLastPurchase(
      mkInput(mkProfile(), [
        inv("2026-05-10T00:00:00Z", -100),
        inv("2026-05-15T00:00:00Z", Number.NaN),
      ])
    )
    // Both invalid → no paid invoices → 0/0.
    expect(r.value).toBe(0)
    expect(r.confidence).toBe(0)
  })
})

/* ─── Type-registry drift guard ───────────────────────────────────────── */

describe("G3 — pre-built registry completeness", () => {
  it("has exactly 4 pre-built insight keys (no silent additions)", () => {
    expect(PREBUILT_INSIGHT_KEYS).toHaveLength(4)
    expect(PREBUILT_INSIGHT_KEYS).toEqual([
      "ltv",
      "churn_risk",
      "engagement_score",
      "days_since_last_purchase",
    ])
  })

  it("PREBUILT_INSIGHT_VALUE_TYPES maps every pre-built key", () => {
    for (const k of PREBUILT_INSIGHT_KEYS) {
      const valueType = PREBUILT_INSIGHT_VALUE_TYPES[k as PrebuiltInsightKey]
      expect(valueType).toBeDefined()
      expect(INSIGHT_VALUE_TYPES).toContain(valueType)
    }
  })
})
