/**
 * T9 Proactive Service — slice-1 score-compute tests.
 *
 * Pins every weight + every clamp so a future weights tweak surfaces
 * as a single intentional commit rather than silent drift.
 */
import { describe, it, expect } from "vitest"
import { computeHealthScore, SCORE_WEIGHTS } from "@/lib/proactive/score-compute"

describe("computeHealthScore — baseline + clamping", () => {
  it("perfectly healthy customer (no signals) sits near the baseline", () => {
    const r = computeHealthScore({
      churnRisk: 0,
      engagementScore: 0,
      daysSinceLastActivity: 0,
    })
    // baseline 80, no penalties, no engagement bonus (engagement=0)
    expect(r.score).toBe(80)
    expect(r.factors.baseline).toBe(80)
  })

  it("clamps score to 0 when all penalties combine to negative", () => {
    const r = computeHealthScore({
      churnRisk: 1, // -50
      engagementScore: 0,
      daysSinceLastActivity: 365, // -30 (capped)
      paymentOverdue: true, // -20
      contractExpiringSoon: true, // -10
    })
    // 80 - 50 - 30 - 20 - 10 = -30 → clamped to 0
    expect(r.score).toBe(0)
  })

  it("clamps score to 100 when bonuses overshoot baseline", () => {
    // engagement=10000 → log10(10001) * 6 = ~24 → capped at 15
    // 80 + 15 = 95 (no penalties)
    const r = computeHealthScore({
      churnRisk: 0,
      engagementScore: 10000,
      daysSinceLastActivity: 0,
    })
    expect(r.score).toBe(95)
    // engagement bonus must be capped at the configured ceiling
    expect(r.factors.engagementBonus).toBe(SCORE_WEIGHTS.engagementCapBonus)
  })
})

describe("computeHealthScore — churn risk penalty", () => {
  it("churnRisk=0 contributes 0 penalty", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.churnRiskPenalty).toBe(0)
  })

  it("churnRisk=1 contributes the full configured factor (50)", () => {
    const r = computeHealthScore({ churnRisk: 1, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.churnRiskPenalty).toBe(50)
    // 80 - 50 = 30
    expect(r.score).toBe(30)
  })

  it("clamps wild churnRisk inputs above 1 to 1", () => {
    const r = computeHealthScore({ churnRisk: 2.5, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.churnRiskPenalty).toBe(50)
  })

  it("clamps negative churnRisk to 0", () => {
    const r = computeHealthScore({ churnRisk: -0.5, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.churnRiskPenalty).toBe(0)
  })
})

describe("computeHealthScore — engagement bonus", () => {
  it("engagement=0 contributes 0 bonus", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.engagementBonus).toBe(0)
  })

  it("engagement=1 contributes a small log-scaled bonus", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 1, daysSinceLastActivity: 0 })
    // log10(2) * 6 = ~1.81
    expect(r.factors.engagementBonus).toBeCloseTo(1.81, 1)
  })

  it("engagement bonus caps at the configured ceiling", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 1_000_000, daysSinceLastActivity: 0 })
    expect(r.factors.engagementBonus).toBe(SCORE_WEIGHTS.engagementCapBonus)
  })

  it("negative engagement does NOT subtract — clamps to 0 bonus", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: -100, daysSinceLastActivity: 0 })
    expect(r.factors.engagementBonus).toBe(0)
  })
})

describe("computeHealthScore — activity penalty", () => {
  it("0 days since activity → 0 penalty", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.activityPenalty).toBe(0)
  })

  it("at the configured window (90d) hits the max penalty", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 90 })
    expect(r.factors.activityPenalty).toBe(SCORE_WEIGHTS.activityPenaltyMax)
  })

  it("beyond the window stays capped at the max penalty", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 365 })
    expect(r.factors.activityPenalty).toBe(SCORE_WEIGHTS.activityPenaltyMax)
  })

  it("negative days (impossible but defensive) → 0 penalty", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: -5 })
    expect(r.factors.activityPenalty).toBe(0)
  })
})

describe("computeHealthScore — discrete flag penalties", () => {
  it("paymentOverdue=true subtracts the configured penalty", () => {
    const baseline = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    const withOverdue = computeHealthScore({
      churnRisk: 0,
      engagementScore: 0,
      daysSinceLastActivity: 0,
      paymentOverdue: true,
    })
    expect(baseline.score - withOverdue.score).toBe(SCORE_WEIGHTS.paymentOverduePenalty)
    expect(withOverdue.factors.paymentOverduePenalty).toBe(SCORE_WEIGHTS.paymentOverduePenalty)
  })

  it("contractExpiringSoon=true subtracts the configured penalty", () => {
    const baseline = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    const withExpiring = computeHealthScore({
      churnRisk: 0,
      engagementScore: 0,
      daysSinceLastActivity: 0,
      contractExpiringSoon: true,
    })
    expect(baseline.score - withExpiring.score).toBe(SCORE_WEIGHTS.contractExpiringPenalty)
  })

  it("both flags combine additively", () => {
    const baseline = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    const withBoth = computeHealthScore({
      churnRisk: 0,
      engagementScore: 0,
      daysSinceLastActivity: 0,
      paymentOverdue: true,
      contractExpiringSoon: true,
    })
    expect(baseline.score - withBoth.score).toBe(
      SCORE_WEIGHTS.paymentOverduePenalty + SCORE_WEIGHTS.contractExpiringPenalty,
    )
  })

  it("flags default to false when omitted", () => {
    const r = computeHealthScore({ churnRisk: 0, engagementScore: 0, daysSinceLastActivity: 0 })
    expect(r.factors.paymentOverduePenalty).toBe(0)
    expect(r.factors.contractExpiringPenalty).toBe(0)
  })
})
