import { describe, it, expect } from "vitest"
import { recomputeAccount, type RecomputeSignal } from "./recompute-account-score"

const ASOF = new Date("2026-06-22T00:00:00.000Z")
const daysAgo = (n: number) => new Date(ASOF.getTime() - n * 86_400_000)
const TARGET = { targetIndustries: ["pharma"], disqualifiedIndustries: [] as string[] }

const FIT_ACCOUNT = {
  icpTier: "tier_1",
  employeeBand: "enterprise",
  industrySlug: "pharma",
  annualRevenueUsd: 20_000_000,
}

describe("recomputeAccount", () => {
  it("scores 0 with no signals but still grades on fit", () => {
    const r = recomputeAccount(FIT_ACCOUNT, [], TARGET, ASOF)
    expect(r.engagementScore).toBe(0)
    expect(r.signalCounts).toEqual({})
    expect(r.lastSignalAt).toBeNull()
    // icp(30) + band(enterprise=20) + industry(target=25) + revenue(20) = 95 → A
    expect(r.grade).toBe("A")
  })

  it("produces a positive score from recent signals and counts them by kind", () => {
    const signals: RecomputeSignal[] = [
      { signalKind: "form_submission", weight: 25, occurredAt: daysAgo(1) },
      { signalKind: "form_submission", weight: 25, occurredAt: daysAgo(2) },
      { signalKind: "email_engagement", weight: 10, occurredAt: daysAgo(3) },
    ]
    const r = recomputeAccount(FIT_ACCOUNT, signals, TARGET, ASOF)
    expect(r.engagementScore).toBeGreaterThan(0)
    expect(r.signalCounts).toEqual({ form_submission: 2, email_engagement: 1 })
    expect(r.lastSignalAt).toEqual(daysAgo(1))
  })

  it("recent activity scores higher than the same signal long ago (decay)", () => {
    const recent = recomputeAccount(
      FIT_ACCOUNT,
      [{ signalKind: "form_submission", weight: 40, occurredAt: daysAgo(1) }],
      TARGET,
      ASOF,
    )
    const old = recomputeAccount(
      FIT_ACCOUNT,
      [{ signalKind: "form_submission", weight: 40, occurredAt: daysAgo(45) }],
      TARGET,
      ASOF,
    )
    expect(recent.engagementScore).toBeGreaterThan(old.engagementScore)
  })

  it("ignores invalid kinds and future-dated signals without crashing", () => {
    const signals: RecomputeSignal[] = [
      { signalKind: "not_a_real_kind", weight: 50, occurredAt: daysAgo(1) },
      { signalKind: "form_submission", weight: 20, occurredAt: daysAgo(-5) }, // future
      { signalKind: "form_submission", weight: 20, occurredAt: daysAgo(1) }, // counts
    ]
    const r = recomputeAccount(FIT_ACCOUNT, signals, TARGET, ASOF)
    expect(r.signalCounts).toEqual({ form_submission: 1 })
    expect(r.engagementScore).toBeGreaterThan(0)
  })

  it("clamps an out-of-range weight instead of erroring the whole account", () => {
    const r = recomputeAccount(
      FIT_ACCOUNT,
      [{ signalKind: "form_submission", weight: 9999, occurredAt: daysAgo(1) }],
      TARGET,
      ASOF,
    )
    // weight clamped to 100 → score capped at 100
    expect(r.engagementScore).toBeGreaterThan(0)
    expect(r.engagementScore).toBeLessThanOrEqual(100)
  })

  it("disqualified industry grades F even with signals", () => {
    const r = recomputeAccount(
      { icpTier: "tier_1", employeeBand: "enterprise", industrySlug: "tobacco", annualRevenueUsd: 5_000_000 },
      [{ signalKind: "form_submission", weight: 30, occurredAt: daysAgo(1) }],
      { targetIndustries: [], disqualifiedIndustries: ["tobacco"] },
      ASOF,
    )
    expect(r.grade).toBe("F")
  })
})
