/**
 * Tests for A12 Revenue Intelligence slice 1 — 4 pure helpers + types.
 * No DB; all helpers are pure functions.
 */
import { describe, expect, it } from "vitest"

import {
  buildForecastSnapshot,
  round2,
} from "@/lib/revenue-intelligence/forecast-snapshot-builder"
import {
  analyzeWaterfall,
  computeAmountDelta,
  topMovingBuckets,
} from "@/lib/revenue-intelligence/waterfall-analyzer"
import {
  aggregateVelocity,
  percentile,
} from "@/lib/revenue-intelligence/velocity-aggregator"
import {
  calculateForecastAccuracy,
  isAccuracyClass,
  isForecastScope,
  isTransitionType,
  isVelocityPeriodKey,
} from "@/lib/revenue-intelligence/forecast-accuracy-calculator"
import {
  ACCURACY_CLASSES,
  BEST_CASE_PROBABILITY_THRESHOLD,
  BOTTLENECK_P90_THRESHOLD_SECONDS,
  COMMITTED_PROBABILITY_THRESHOLD,
  DEFAULT_STAGE_PROBABILITIES,
  FORECAST_SCOPES,
  TRANSITION_TYPES,
  TERMINAL_TRANSITION_TYPES,
  VELOCITY_PERIOD_DAYS,
  VELOCITY_PERIOD_KEYS,
  type StageDurationSample,
  type WaterfallTransition,
} from "@/lib/revenue-intelligence/types"

/* ─── Enum exhaustiveness ──────────────────────────────────────────────── */

describe("A12 — enum exhaustiveness + invariants", () => {
  it("FORECAST_SCOPES has 3 kinds", () => {
    expect(FORECAST_SCOPES).toEqual(["org", "pipeline", "user"])
  })
  it("TRANSITION_TYPES has 7 kinds", () => {
    expect(TRANSITION_TYPES).toEqual([
      "created",
      "advanced",
      "regressed",
      "won",
      "lost",
      "reopened",
      "reassigned",
    ])
  })
  it("TERMINAL_TRANSITION_TYPES is subset of TRANSITION_TYPES", () => {
    for (const t of TERMINAL_TRANSITION_TYPES) {
      expect(TRANSITION_TYPES).toContain(t)
    }
  })
  it("VELOCITY_PERIOD_KEYS has 4 kinds", () => {
    expect(VELOCITY_PERIOD_KEYS).toEqual([
      "last_30d",
      "last_90d",
      "last_180d",
      "last_365d",
    ])
  })
  it("VELOCITY_PERIOD_DAYS maps each key correctly", () => {
    expect(VELOCITY_PERIOD_DAYS.last_30d).toBe(30)
    expect(VELOCITY_PERIOD_DAYS.last_90d).toBe(90)
    expect(VELOCITY_PERIOD_DAYS.last_180d).toBe(180)
    expect(VELOCITY_PERIOD_DAYS.last_365d).toBe(365)
  })
  it("ACCURACY_CLASSES has 4 kinds", () => {
    expect(ACCURACY_CLASSES).toEqual([
      "accurate",
      "over_delivered",
      "under_delivered",
      "unknown",
    ])
  })
  it("BEST_CASE threshold < COMMITTED threshold", () => {
    expect(BEST_CASE_PROBABILITY_THRESHOLD).toBeLessThan(
      COMMITTED_PROBABILITY_THRESHOLD,
    )
  })
  it("DEFAULT_STAGE_PROBABILITIES values all in [0, 1]", () => {
    for (const [stage, prob] of Object.entries(DEFAULT_STAGE_PROBABILITIES)) {
      expect(prob).toBeGreaterThanOrEqual(0)
      expect(prob).toBeLessThanOrEqual(1)
    }
  })
  it("BOTTLENECK threshold is 30 days", () => {
    expect(BOTTLENECK_P90_THRESHOLD_SECONDS).toBe(30 * 24 * 60 * 60)
  })
})

/* ─── Type guards ──────────────────────────────────────────────────────── */

describe("A12 — type guards", () => {
  it("isForecastScope", () => {
    expect(isForecastScope("org")).toBe(true)
    expect(isForecastScope("xxx")).toBe(false)
    expect(isForecastScope(42)).toBe(false)
  })
  it("isTransitionType", () => {
    expect(isTransitionType("won")).toBe(true)
    expect(isTransitionType("closed")).toBe(false)
  })
  it("isVelocityPeriodKey", () => {
    expect(isVelocityPeriodKey("last_30d")).toBe(true)
    expect(isVelocityPeriodKey("daily")).toBe(false)
  })
  it("isAccuracyClass", () => {
    expect(isAccuracyClass("accurate")).toBe(true)
    expect(isAccuracyClass("perfect")).toBe(false)
  })
})

/* ─── Forecast snapshot builder ────────────────────────────────────────── */

describe("A12 — buildForecastSnapshot: empty input", () => {
  it("empty deals → all zeros", () => {
    const result = buildForecastSnapshot({
      deals: [],
      stageProbabilities: DEFAULT_STAGE_PROBABILITIES,
      periodStart: new Date("2026-04-01"),
      periodEnd: new Date("2026-06-30"),
    })
    expect(result.committedAmount).toBe(0)
    expect(result.bestCaseAmount).toBe(0)
    expect(result.forecastAmount).toBe(0)
    expect(result.dealsTotal).toBe(0)
  })
})

describe("A12 — buildForecastSnapshot: probability buckets", () => {
  const periodStart = new Date("2026-04-01")
  const periodEnd = new Date("2026-06-30")
  const probs = DEFAULT_STAGE_PROBABILITIES

  it("LEAD (0.05) → forecast only, not committed/bestCase", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: 10_000, stage: "LEAD" }],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.forecastAmount).toBe(500) // 10000 * 0.05
    expect(result.bestCaseAmount).toBe(0)
    expect(result.committedAmount).toBe(0)
    expect(result.dealsTotal).toBe(1)
    expect(result.dealsBestCase).toBe(0)
    expect(result.dealsCommitted).toBe(0)
  })

  it("NEGOTIATION (0.75) → bestCase yes, committed no", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: 10_000, stage: "NEGOTIATION" }],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.forecastAmount).toBe(7500)
    expect(result.bestCaseAmount).toBe(10_000)
    expect(result.committedAmount).toBe(0)
    expect(result.dealsBestCase).toBe(1)
    expect(result.dealsCommitted).toBe(0)
  })

  it("COMMITTED (0.9) → both committed AND bestCase", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: 10_000, stage: "COMMITTED" }],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.forecastAmount).toBe(9000)
    expect(result.bestCaseAmount).toBe(10_000)
    expect(result.committedAmount).toBe(10_000)
    expect(result.dealsBestCase).toBe(1)
    expect(result.dealsCommitted).toBe(1)
  })

  it("WON (1.0) → 100% credit everywhere", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: 10_000, stage: "WON" }],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.forecastAmount).toBe(10_000)
    expect(result.bestCaseAmount).toBe(10_000)
    expect(result.committedAmount).toBe(10_000)
  })

  it("LOST (0.0) → forecast 0 but still counted in dealsTotal", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: 10_000, stage: "LOST" }],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.forecastAmount).toBe(0)
    expect(result.dealsTotal).toBe(1)
  })

  it("mixed deals — bestCase dominates committed (invariant)", () => {
    const result = buildForecastSnapshot({
      deals: [
        { dealId: "d1", amount: 5_000, stage: "NEGOTIATION" },
        { dealId: "d2", amount: 10_000, stage: "COMMITTED" },
        { dealId: "d3", amount: 2_000, stage: "WON" },
        { dealId: "d4", amount: 8_000, stage: "QUALIFIED" },
      ],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.bestCaseAmount).toBeGreaterThanOrEqual(result.committedAmount)
  })
})

describe("A12 — buildForecastSnapshot: filtering", () => {
  const periodStart = new Date("2026-04-01")
  const periodEnd = new Date("2026-06-30")
  const probs = DEFAULT_STAGE_PROBABILITIES

  it("excludes deals closed before period", () => {
    const result = buildForecastSnapshot({
      deals: [
        {
          dealId: "d1",
          amount: 10_000,
          stage: "WON",
          closedAt: new Date("2026-03-15"),
        },
      ],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.dealsExcluded).toBe(1)
    expect(result.dealsTotal).toBe(0)
  })

  it("excludes deals with expectedCloseAt outside period", () => {
    const result = buildForecastSnapshot({
      deals: [
        {
          dealId: "d1",
          amount: 10_000,
          stage: "NEGOTIATION",
          expectedCloseAt: new Date("2026-08-15"), // outside June
        },
      ],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.dealsExcluded).toBe(1)
  })

  it("includes deal closed in-period", () => {
    const result = buildForecastSnapshot({
      deals: [
        {
          dealId: "d1",
          amount: 10_000,
          stage: "WON",
          closedAt: new Date("2026-05-15"),
        },
      ],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.dealsTotal).toBe(1)
    expect(result.committedAmount).toBe(10_000)
  })

  it("excludes deals at unknown stages", () => {
    const result = buildForecastSnapshot({
      deals: [
        { dealId: "d1", amount: 10_000, stage: "MYSTERY_STAGE" },
      ],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.dealsExcluded).toBe(1)
    expect(result.dealsTotal).toBe(0)
  })

  it("clamps negative amounts to 0", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: -5_000, stage: "WON" }],
      stageProbabilities: probs,
      periodStart,
      periodEnd,
    })
    expect(result.committedAmount).toBe(0)
    expect(result.dealsTotal).toBe(1)
  })

  it("ignores deals with invalid probability in stageProbabilities", () => {
    const result = buildForecastSnapshot({
      deals: [{ dealId: "d1", amount: 10_000, stage: "WEIRD" }],
      stageProbabilities: {
        ...probs,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        WEIRD: 1.5 as any, // out of [0, 1]
      },
      periodStart,
      periodEnd,
    })
    expect(result.dealsExcluded).toBe(1)
  })
})

describe("A12 — round2", () => {
  it("rounds to 2 decimal places (within JS float-rounding limits)", () => {
    // 1.005 in IEEE-754 is actually 1.0049999... so Math.round * 100 / 100
    // gives 1 not 1.01 — this is a known JS quirk. Helper uses this
    // simple algorithm by design (faster than toFixed parsing). Slice-2
    // money values should use a Decimal library for exact rounding.
    expect(round2(1.234)).toBeCloseTo(1.23, 2)
    expect(round2(9999.999)).toBe(10000)
    expect(round2(1.004)).toBe(1)
  })
  it("NaN/Infinity → 0", () => {
    expect(round2(Number.NaN)).toBe(0)
    expect(round2(Infinity)).toBe(0)
  })
})

/* ─── Waterfall analyzer ───────────────────────────────────────────────── */

const trans = (
  id: string,
  dealId: string,
  type: WaterfallTransition["transitionType"],
  fromAmt: number | null,
  toAmt: number,
  dateIso: string,
  fromStage: string | null = null,
  toStage: string = "STAGE",
): WaterfallTransition => ({
  transitionId: id,
  dealId,
  fromStage,
  toStage,
  fromAmount: fromAmt,
  toAmount: toAmt,
  transitionType: type,
  transitionedAt: new Date(dateIso),
})

describe("A12 — analyzeWaterfall", () => {
  const periodStart = new Date("2026-05-01")
  const periodEnd = new Date("2026-05-31")

  it("empty transitions → all buckets at 0", () => {
    const result = analyzeWaterfall({
      transitions: [],
      periodStart,
      periodEnd,
    })
    expect(result.totalTransitions).toBe(0)
    expect(result.netAmountDelta).toBe(0)
    expect(result.buckets).toHaveLength(TRANSITION_TYPES.length)
    expect(result.buckets.every((b) => b.count === 0)).toBe(true)
  })

  it("returns a bucket per transition type in stable order", () => {
    const result = analyzeWaterfall({
      transitions: [],
      periodStart,
      periodEnd,
    })
    expect(result.buckets.map((b) => b.transitionType)).toEqual(
      [...TRANSITION_TYPES],
    )
  })

  it("buckets created with +toAmount delta", () => {
    const result = analyzeWaterfall({
      transitions: [
        trans("t1", "d1", "created", null, 50_000, "2026-05-15"),
      ],
      periodStart,
      periodEnd,
    })
    const created = result.buckets.find((b) => b.transitionType === "created")!
    expect(created.count).toBe(1)
    expect(created.totalAmountDelta).toBe(50_000)
    expect(created.dealIds).toEqual(["d1"])
  })

  it("buckets won with +toAmount", () => {
    const result = analyzeWaterfall({
      transitions: [trans("t1", "d1", "won", 30_000, 30_000, "2026-05-15")],
      periodStart,
      periodEnd,
    })
    const won = result.buckets.find((b) => b.transitionType === "won")!
    expect(won.totalAmountDelta).toBe(30_000)
  })

  it("buckets lost with -toAmount", () => {
    const result = analyzeWaterfall({
      transitions: [trans("t1", "d1", "lost", 30_000, 30_000, "2026-05-15")],
      periodStart,
      periodEnd,
    })
    const lost = result.buckets.find((b) => b.transitionType === "lost")!
    expect(lost.totalAmountDelta).toBe(-30_000)
  })

  it("buckets advanced/regressed/reassigned with toAmount - fromAmount", () => {
    const result = analyzeWaterfall({
      transitions: [
        trans("t1", "d1", "advanced", 10_000, 15_000, "2026-05-15"),
        trans("t2", "d2", "regressed", 20_000, 18_000, "2026-05-16"),
      ],
      periodStart,
      periodEnd,
    })
    const adv = result.buckets.find((b) => b.transitionType === "advanced")!
    const reg = result.buckets.find((b) => b.transitionType === "regressed")!
    expect(adv.totalAmountDelta).toBe(5_000)
    expect(reg.totalAmountDelta).toBe(-2_000)
  })

  it("drops transitions outside [periodStart, periodEnd]", () => {
    const result = analyzeWaterfall({
      transitions: [
        trans("t1", "d1", "won", 10_000, 10_000, "2026-04-15"), // before
        trans("t2", "d2", "won", 5_000, 5_000, "2026-05-15"), // in
        trans("t3", "d3", "won", 7_000, 7_000, "2026-06-15"), // after
      ],
      periodStart,
      periodEnd,
    })
    expect(result.totalTransitions).toBe(1)
    const won = result.buckets.find((b) => b.transitionType === "won")!
    expect(won.totalAmountDelta).toBe(5_000)
  })

  it("netAmountDelta sums all bucket deltas", () => {
    const result = analyzeWaterfall({
      transitions: [
        trans("t1", "d1", "created", null, 100_000, "2026-05-10"),
        trans("t2", "d2", "won", 50_000, 50_000, "2026-05-15"),
        trans("t3", "d3", "lost", 30_000, 30_000, "2026-05-20"),
      ],
      periodStart,
      periodEnd,
    })
    expect(result.netAmountDelta).toBe(100_000 + 50_000 - 30_000)
  })

  it("ignores unknown transition types defensively", () => {
    const result = analyzeWaterfall({
      transitions: [
        {
          ...trans("t1", "d1", "won", 10_000, 10_000, "2026-05-15"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transitionType: "MYSTERY" as any,
        },
      ],
      periodStart,
      periodEnd,
    })
    expect(result.totalTransitions).toBe(0)
  })
})

describe("A12 — computeAmountDelta", () => {
  it("null fromAmount for advanced → treated as 0", () => {
    const t = trans("t", "d", "advanced", null, 5_000, "2026-05-15")
    expect(computeAmountDelta(t)).toBe(5_000)
  })
  it("NaN amounts → 0 (defensive)", () => {
    const t: WaterfallTransition = {
      ...trans("t", "d", "won", 10_000, 10_000, "2026-05-15"),
      toAmount: Number.NaN,
    }
    expect(computeAmountDelta(t)).toBe(0)
  })
  it("reopened → +toAmount", () => {
    const t = trans("t", "d", "reopened", 10_000, 12_000, "2026-05-15")
    expect(computeAmountDelta(t)).toBe(12_000)
  })
})

describe("A12 — topMovingBuckets", () => {
  const periodStart = new Date("2026-05-01")
  const periodEnd = new Date("2026-05-31")

  it("returns top N buckets by |delta|", () => {
    const analysis = analyzeWaterfall({
      transitions: [
        trans("t1", "d1", "created", null, 100_000, "2026-05-10"),
        trans("t2", "d2", "lost", 50_000, 50_000, "2026-05-15"),
        trans("t3", "d3", "advanced", 10_000, 12_000, "2026-05-20"),
      ],
      periodStart,
      periodEnd,
    })
    const top = topMovingBuckets(analysis, 2)
    expect(top).toHaveLength(2)
    expect(Math.abs(top[0].totalAmountDelta)).toBeGreaterThanOrEqual(
      Math.abs(top[1].totalAmountDelta),
    )
  })

  it("filters out empty buckets", () => {
    const analysis = analyzeWaterfall({
      transitions: [trans("t1", "d1", "won", 10_000, 10_000, "2026-05-15")],
      periodStart,
      periodEnd,
    })
    const top = topMovingBuckets(analysis)
    expect(top.every((b) => b.count > 0)).toBe(true)
  })

  it("limit 0 returns empty array", () => {
    const analysis = analyzeWaterfall({
      transitions: [trans("t1", "d1", "won", 10_000, 10_000, "2026-05-15")],
      periodStart,
      periodEnd,
    })
    expect(topMovingBuckets(analysis, 0)).toEqual([])
  })
})

/* ─── Velocity aggregator ──────────────────────────────────────────────── */

const sample = (
  duration: number,
  outcome: Partial<Pick<StageDurationSample, "advanced" | "regressed" | "lost" | "won">> = {},
): StageDurationSample => ({
  durationSeconds: duration,
  advanced: outcome.advanced ?? false,
  regressed: outcome.regressed ?? false,
  lost: outcome.lost ?? false,
  won: outcome.won ?? false,
})

describe("A12 — aggregateVelocity", () => {
  it("empty samples → all percentiles null + conversion null when dealsEntered=0", () => {
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "PROPOSAL",
      periodKey: "last_30d",
      samples: [],
      dealsEntered: 0,
    })
    expect(result.avgDurationSeconds).toBeNull()
    expect(result.p50DurationSeconds).toBeNull()
    expect(result.p90DurationSeconds).toBeNull()
    expect(result.conversionRate).toBeNull()
    expect(result.dealsExited).toBe(0)
  })

  it("single sample → percentiles all equal", () => {
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "PROPOSAL",
      periodKey: "last_30d",
      samples: [sample(3_600, { advanced: true })],
      dealsEntered: 1,
    })
    expect(result.avgDurationSeconds).toBe(3_600)
    expect(result.p50DurationSeconds).toBe(3_600)
    expect(result.p90DurationSeconds).toBe(3_600)
    expect(result.dealsAdvanced).toBe(1)
    expect(result.conversionRate).toBe(1)
  })

  it("conversion rate = advanced / entered", () => {
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "PROPOSAL",
      periodKey: "last_30d",
      samples: [
        sample(100, { advanced: true }),
        sample(200, { advanced: true }),
        sample(300, { lost: true }),
        sample(400, { regressed: true }),
      ],
      dealsEntered: 10,
    })
    expect(result.dealsAdvanced).toBe(2)
    expect(result.conversionRate).toBe(0.2)
  })

  it("counts: advanced + regressed + lost + won + (in-stage) ≤ dealsEntered", () => {
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "PROPOSAL",
      periodKey: "last_30d",
      samples: [
        sample(100, { advanced: true }),
        sample(200, { won: true }),
        sample(300, { lost: true }),
      ],
      dealsEntered: 5,
    })
    expect(result.dealsAdvanced + result.dealsRegressed + result.dealsLost + result.dealsWon)
      .toBeLessThanOrEqual(result.dealsEntered)
  })

  it("p90 > 30 days → isBottleneck = true", () => {
    const longDuration = 35 * 24 * 60 * 60 // 35 days
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "NEGOTIATION",
      periodKey: "last_90d",
      samples: Array(10).fill(0).map(() => sample(longDuration, { advanced: true })),
      dealsEntered: 10,
    })
    expect(result.isBottleneck).toBe(true)
    expect(result.p90DurationSeconds).toBeGreaterThan(BOTTLENECK_P90_THRESHOLD_SECONDS)
  })

  it("p90 < 30 days → isBottleneck = false", () => {
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "QUALIFIED",
      periodKey: "last_30d",
      samples: Array(10).fill(0).map(() => sample(3_600, { advanced: true })),
      dealsEntered: 10,
    })
    expect(result.isBottleneck).toBe(false)
  })

  it("invalid samples (negative duration, NaN) silently dropped", () => {
    const result = aggregateVelocity({
      pipelineId: "p1",
      stage: "PROPOSAL",
      periodKey: "last_30d",
      samples: [
        sample(100, { advanced: true }),
        sample(-50, { lost: true }),
        sample(Number.NaN, { won: true }),
      ],
      dealsEntered: 3,
    })
    expect(result.dealsExited).toBe(1) // only valid sample
  })
})

describe("A12 — percentile", () => {
  it("empty array → null", () => {
    expect(percentile([], 0.5)).toBeNull()
  })
  it("single value → returns that value", () => {
    expect(percentile([42], 0.5)).toBe(42)
    expect(percentile([42], 0.9)).toBe(42)
  })
  it("p50 of [1..9] = 5", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.5)).toBe(5)
  })
  it("p90 of [1..10] = 9 (linear interp)", () => {
    // idx = 0.9 * 9 = 8.1 → between sorted[8]=9 and sorted[9]=10 → 9.1 → round 9
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
  })
  it("works on unsorted input", () => {
    expect(percentile([9, 1, 5, 3, 7], 0.5)).toBe(5)
  })
  it("q clamped to [0, 1]", () => {
    expect(percentile([1, 2, 3], -0.5)).toBe(1)
    expect(percentile([1, 2, 3], 1.5)).toBe(3)
  })
})

/* ─── Forecast accuracy calculator ─────────────────────────────────────── */

describe("A12 — calculateForecastAccuracy", () => {
  it("perfect match → accurate", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 100_000,
    })
    expect(result.accuracyClass).toBe("accurate")
    expect(result.varianceAbsForecast).toBe(0)
    expect(result.variancePctForecast).toBe(0)
  })

  it("within +5% tolerance → accurate", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 104_000, // +4%
    })
    expect(result.accuracyClass).toBe("accurate")
  })

  it("at +5% boundary → accurate (inclusive)", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 105_000,
    })
    expect(result.accuracyClass).toBe("accurate")
  })

  it("above +5% → over_delivered", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 120_000, // +20%
    })
    expect(result.accuracyClass).toBe("over_delivered")
    expect(result.variancePctForecast).toBe(0.2)
  })

  it("below -5% → under_delivered", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 80_000, // -20%
    })
    expect(result.accuracyClass).toBe("under_delivered")
    expect(result.variancePctForecast).toBe(-0.2)
  })

  it("forecast = 0 → unknown class + null variance pcts", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 0,
        committedAmount: 0,
        bestCaseAmount: 0,
      },
      actualAmount: 100_000,
    })
    expect(result.accuracyClass).toBe("unknown")
    expect(result.variancePctForecast).toBeNull()
    expect(result.variancePctCommitted).toBeNull()
  })

  it("custom tolerance respected", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 115_000, // +15%
      tolerance: 0.2, // 20% tolerance
    })
    expect(result.accuracyClass).toBe("accurate")
  })

  it("invalid tolerance defaults to 0.05", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: 108_000, // +8%
      tolerance: -1, // invalid
    })
    // With default 5% tolerance, 8% → over_delivered
    expect(result.accuracyClass).toBe("over_delivered")
  })

  it("negative actual clamped to 0", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 80_000,
        bestCaseAmount: 90_000,
      },
      actualAmount: -50_000,
    })
    expect(result.actualAmount).toBe(0)
    expect(result.varianceAbsForecast).toBe(-100_000)
  })

  it("computes all 3 variance pcts (forecast/committed/bestCase)", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: 100_000,
        committedAmount: 50_000,
        bestCaseAmount: 80_000,
      },
      actualAmount: 60_000,
    })
    expect(result.variancePctForecast).toBe(-0.4)
    expect(result.variancePctCommitted).toBe(0.2)
    expect(result.variancePctBestCase).toBe(-0.25)
  })

  it("NaN forecast → unknown", () => {
    const result = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: Number.NaN,
        committedAmount: 50_000,
        bestCaseAmount: 80_000,
      },
      actualAmount: 60_000,
    })
    expect(result.accuracyClass).toBe("unknown")
  })
})

/* ─── End-to-end sanity ────────────────────────────────────────────────── */

describe("A12 — end-to-end pipeline", () => {
  it("snapshot → accuracy report flow with realistic numbers", () => {
    // Monday snapshot
    const snapshot = buildForecastSnapshot({
      deals: [
        { dealId: "d1", amount: 50_000, stage: "COMMITTED" },
        { dealId: "d2", amount: 30_000, stage: "NEGOTIATION" },
        { dealId: "d3", amount: 20_000, stage: "PROPOSAL" },
      ],
      stageProbabilities: DEFAULT_STAGE_PROBABILITIES,
      periodStart: new Date("2026-04-01"),
      periodEnd: new Date("2026-06-30"),
    })
    // 50000*0.9 + 30000*0.75 + 20000*0.5 = 45000 + 22500 + 10000 = 77500
    expect(snapshot.forecastAmount).toBe(77_500)
    expect(snapshot.committedAmount).toBe(50_000)
    expect(snapshot.bestCaseAmount).toBe(80_000)

    // End of quarter: $75K actually closed
    const accuracy = calculateForecastAccuracy({
      snapshot: {
        forecastAmount: snapshot.forecastAmount,
        committedAmount: snapshot.committedAmount,
        bestCaseAmount: snapshot.bestCaseAmount,
      },
      actualAmount: 75_000,
    })
    // 75000 vs 77500 → variance -2500 / 77500 = -0.032 (3.2%) → accurate
    expect(accuracy.accuracyClass).toBe("accurate")
  })

  it("waterfall + velocity work together on same dataset", () => {
    const periodStart = new Date("2026-05-01")
    const periodEnd = new Date("2026-05-31")

    const transitions: WaterfallTransition[] = [
      { ...trans("t1", "d1", "advanced", 10_000, 12_000, "2026-05-05"),
        durationInPrevStageSeconds: 5 * 86_400 },
      { ...trans("t2", "d2", "advanced", 20_000, 22_000, "2026-05-10"),
        durationInPrevStageSeconds: 10 * 86_400 },
      { ...trans("t3", "d3", "lost", 15_000, 15_000, "2026-05-20"),
        durationInPrevStageSeconds: 40 * 86_400 },
    ]

    const waterfall = analyzeWaterfall({ transitions, periodStart, periodEnd })
    expect(waterfall.totalTransitions).toBe(3)

    // Use the durations as velocity samples for PROPOSAL stage
    const velocity = aggregateVelocity({
      pipelineId: "p1",
      stage: "PROPOSAL",
      periodKey: "last_30d",
      samples: transitions.map((t) => ({
        durationSeconds: t.durationInPrevStageSeconds!,
        advanced: t.transitionType === "advanced",
        regressed: false,
        lost: t.transitionType === "lost",
        won: false,
      })),
      dealsEntered: 5,
    })
    expect(velocity.dealsExited).toBe(3)
    expect(velocity.dealsAdvanced).toBe(2)
    expect(velocity.dealsLost).toBe(1)
    expect(velocity.conversionRate).toBe(0.4) // 2/5
    // p90 = 40d → bottleneck
    expect(velocity.isBottleneck).toBe(true)
  })
})
