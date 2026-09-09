/**
 * M10 Content Performance AI — slice-1 score-compute tests.
 *
 * Pins every weight + every clamp + the sample-size dampening invariant.
 */
import { describe, it, expect } from "vitest"
import {
  computeContentScore,
  CONTENT_SCORE_WEIGHTS,
} from "@/lib/content-perf/score-compute"

const FIXED_NOW = new Date("2026-05-29T16:00:00.000Z")

function blank() {
  return {
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalBounced: 0,
    totalUnsubscribed: 0,
    totalSpam: 0,
    lastSentAt: null as Date | null,
    now: FIXED_NOW,
  }
}

describe("computeContentScore — baseline", () => {
  it("zero-data content sits at the baseline (no signal, no bonuses, no penalties)", () => {
    const r = computeContentScore(blank())
    expect(r.score).toBe(CONTENT_SCORE_WEIGHTS.baseline)
    expect(r.factors.sampleSize).toBe(0)
  })
})

describe("computeContentScore — open rate bonus", () => {
  it("openRate=0 gives 0 bonus", () => {
    const r = computeContentScore({ ...blank(), totalSent: 100, totalOpened: 0 })
    expect(r.factors.openBonus).toBe(0)
  })

  it("openRate=0.30 (strong B2B benchmark) gives a meaningful bonus", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalOpened: 30,
    })
    expect(r.factors.openRate).toBe(0.3)
    // 0.3 × 85 = 25.5, capped at 30, full sample-size factor = 25.5
    expect(r.factors.openBonus).toBeCloseTo(25.5, 1)
  })

  it("openRate=1 (impossible but defensive) caps at openRateBonusMax", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalOpened: 100,
    })
    expect(r.factors.openBonus).toBe(CONTENT_SCORE_WEIGHTS.openRateBonusMax)
  })
})

describe("computeContentScore — click rate bonus", () => {
  it("click rate is ratio against opens, not sends", () => {
    // 100 sent, 50 opened, 5 clicked → clickRate = 5/50 = 0.10
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalOpened: 50,
      totalClicked: 5,
    })
    expect(r.factors.clickRate).toBe(0.1)
  })

  it("clickRate=0.05 gives a strong bonus", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalOpened: 100,
      totalClicked: 5,
    })
    // 0.05 × 250 = 12.5, no cap hit
    expect(r.factors.clickBonus).toBeCloseTo(12.5, 1)
  })

  it("clickRate caps at clickRateBonusMax", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalOpened: 100,
      totalClicked: 100,
    })
    expect(r.factors.clickBonus).toBe(CONTENT_SCORE_WEIGHTS.clickRateBonusMax)
  })
})

describe("computeContentScore — penalties", () => {
  it("bounceRate=0.02 (red flag) subtracts ~1 point", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalBounced: 2,
    })
    expect(r.factors.bouncePenalty).toBeCloseTo(1, 1)
  })

  it("bouncePenalty caps", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalBounced: 100,
    })
    expect(r.factors.bouncePenalty).toBe(CONTENT_SCORE_WEIGHTS.bounceRatePenaltyMax)
  })

  it("unsubscribeRate=0.01 (red flag) subtracts ~0.8", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalUnsubscribed: 1,
    })
    expect(r.factors.unsubscribePenalty).toBeCloseTo(0.8, 1)
  })

  it("spamRate is harshest — caps at spamRatePenaltyMax", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalSpam: 100,
    })
    expect(r.factors.spamPenalty).toBe(CONTENT_SCORE_WEIGHTS.spamRatePenaltyMax)
  })

  it("penalties are NOT dampened by sample size — even 5-send 100% bounce gets full bounce signal", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 5, // below minSampleSize
      totalBounced: 5,
    })
    // bouncePenalty = clamp(1.0 × 50, 0, 20) = 20 — sample-size doesn't dampen it
    expect(r.factors.bouncePenalty).toBe(CONTENT_SCORE_WEIGHTS.bounceRatePenaltyMax)
  })
})

describe("computeContentScore — sample size dampening", () => {
  it("low sample size dampens BONUSES proportionally", () => {
    // 5 sent (10% of minSampleSize=50), 30% open
    const r = computeContentScore({
      ...blank(),
      totalSent: 5,
      totalOpened: 2,
    })
    expect(r.factors.sampleSizeFactor).toBeCloseTo(0.1, 2)
    // Raw bonus would be ~30 but with 10% dampening → ~3
    expect(r.factors.openBonus).toBeLessThan(5)
  })

  it("sample size at min gives full credit", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: CONTENT_SCORE_WEIGHTS.minSampleSize,
      totalOpened: 15,
    })
    expect(r.factors.sampleSizeFactor).toBe(1)
  })

  it("sample size above min stays capped at 1", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 5000,
      totalOpened: 1500,
    })
    expect(r.factors.sampleSizeFactor).toBe(1)
  })
})

describe("computeContentScore — recency penalty", () => {
  it("brand-new content (lastSentAt = now) has no recency penalty", () => {
    const r = computeContentScore({ ...blank(), lastSentAt: FIXED_NOW })
    expect(r.factors.recencyPenalty).toBe(0)
  })

  it("content at the cap age applies the max penalty", () => {
    const old = new Date(FIXED_NOW.getTime() - 200 * 86_400_000)
    const r = computeContentScore({ ...blank(), lastSentAt: old })
    expect(r.factors.recencyPenalty).toBe(CONTENT_SCORE_WEIGHTS.recencyPenaltyMax)
  })

  it("half-cap age applies half-penalty", () => {
    const ageDays = CONTENT_SCORE_WEIGHTS.recencyPenaltyMaxDays / 2
    const old = new Date(FIXED_NOW.getTime() - ageDays * 86_400_000)
    const r = computeContentScore({ ...blank(), lastSentAt: old })
    expect(r.factors.recencyPenalty).toBeCloseTo(
      CONTENT_SCORE_WEIGHTS.recencyPenaltyMax / 2,
      1,
    )
  })

  it("null lastSentAt means no recency penalty (unsent or unknown)", () => {
    const r = computeContentScore({ ...blank(), lastSentAt: null })
    expect(r.factors.recencyPenalty).toBe(0)
  })
})

describe("computeContentScore — composite scenarios", () => {
  it("excellent campaign (high open + click, no bad signals, fresh) approaches 100", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 5000,
      totalOpened: 1500, // 30% open
      totalClicked: 100, // ~6.7% click rate
      lastSentAt: FIXED_NOW,
    })
    // 50 baseline + ~25.5 open + ~16.7 click → ~92
    expect(r.score).toBeGreaterThan(85)
  })

  it("disaster campaign (very low open, very high bounce + spam) drops below 30", () => {
    // Penalty multipliers are LINEAR until cap, so it takes severe rates
    // to overwhelm the baseline. 30% bounce + 20% spam is "list compromised"
    // territory; this test pins that scenario explicitly.
    const r = computeContentScore({
      ...blank(),
      totalSent: 1000,
      totalOpened: 30, // 3% open
      totalBounced: 300, // 30% bounce
      totalSpam: 200, // 20% spam
      lastSentAt: FIXED_NOW,
    })
    // 50 + ~2.5 open − 15 bounce − 25 spam (capped) = ~12, clamped to 12
    expect(r.score).toBeLessThan(30)
  })

  it("exact integer pin — deterministic input produces deterministic score", () => {
    // Architect P3: at least one .toBe() for sign-flip detection.
    // 100 sent, 30 opens, 15 clicks, no penalties, no recency.
    // openBonus = clamp(0.3 × 85, 0, 30) × 1 = 25.5
    // clickBonus = clamp(0.5 × 250, 0, 25) × 1 = 25
    // Total = 50 + 25.5 + 25 = 100.5 → round → 101 → clamp → 100
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalOpened: 30,
      totalClicked: 15,
      lastSentAt: FIXED_NOW,
    })
    expect(r.score).toBe(100)
  })

  it("clamps total score to [0, 100]", () => {
    const r = computeContentScore({
      ...blank(),
      totalSent: 100,
      totalBounced: 100,
      totalSpam: 100,
      totalUnsubscribed: 100,
    })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })
})
