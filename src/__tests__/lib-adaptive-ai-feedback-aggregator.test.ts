/**
 * A9 Adaptive AI Models — slice-1 feedback-aggregator tests.
 *
 * Pins every accuracy metric + sample-size confidence dampening
 * invariant. Slice-3 adaptive cron will read these results to bias
 * future predictions; a silent metric drift would propagate widely.
 */
import { describe, it, expect } from "vitest"
import {
  aggregateFeedback,
  MIN_SAMPLE_SIZE_FOR_CONFIDENCE,
} from "@/lib/adaptive-ai/feedback-aggregator"

describe("aggregateFeedback — empty input", () => {
  it("zero-feedback returns a fully-zeroed result", () => {
    const r = aggregateFeedback([])
    expect(r).toEqual({
      sampleSize: 0,
      negativeCount: 0,
      neutralCount: 0,
      positiveCount: 0,
      avgRating: 0,
      approvalRate: 0,
      adjustmentFactor: 0,
    })
  })
})

describe("aggregateFeedback — vote counting", () => {
  it("counts each rating bucket separately", () => {
    const r = aggregateFeedback([
      { rating: 1, predictionValue: null },
      { rating: 1, predictionValue: null },
      { rating: 0, predictionValue: null },
      { rating: -1, predictionValue: null },
    ])
    expect(r.positiveCount).toBe(2)
    expect(r.neutralCount).toBe(1)
    expect(r.negativeCount).toBe(1)
    expect(r.sampleSize).toBe(4)
  })

  it("clamps out-of-range ratings to nearest valid value", () => {
    const r = aggregateFeedback([
      { rating: 2 as 1, predictionValue: null }, // clamps to +1
      { rating: -3 as -1, predictionValue: null }, // clamps to -1
    ])
    expect(r.positiveCount).toBe(1)
    expect(r.negativeCount).toBe(1)
  })

  it("treats fractional ratings defensively (rounds away from zero)", () => {
    const r = aggregateFeedback([
      { rating: 0.4 as 1, predictionValue: null }, // → +1
      { rating: -0.7 as -1, predictionValue: null }, // → -1
    ])
    expect(r.positiveCount).toBe(1)
    expect(r.negativeCount).toBe(1)
  })
})

describe("aggregateFeedback — avgRating", () => {
  it("all positive → avgRating = 1", () => {
    const r = aggregateFeedback([
      { rating: 1, predictionValue: null },
      { rating: 1, predictionValue: null },
      { rating: 1, predictionValue: null },
    ])
    expect(r.avgRating).toBe(1)
  })

  it("all negative → avgRating = -1", () => {
    const r = aggregateFeedback([
      { rating: -1, predictionValue: null },
      { rating: -1, predictionValue: null },
    ])
    expect(r.avgRating).toBe(-1)
  })

  it("mixed evens → 0", () => {
    const r = aggregateFeedback([
      { rating: 1, predictionValue: null },
      { rating: -1, predictionValue: null },
    ])
    expect(r.avgRating).toBe(0)
  })

  it("rounds to 3 decimal places", () => {
    const r = aggregateFeedback([
      { rating: 1, predictionValue: null },
      { rating: 1, predictionValue: null },
      { rating: -1, predictionValue: null },
    ])
    // (1+1-1)/3 = 0.333...
    expect(r.avgRating).toBe(0.333)
  })
})

describe("aggregateFeedback — approvalRate", () => {
  it("approvalRate uses only positive + negative (ignores neutrals)", () => {
    const r = aggregateFeedback([
      { rating: 1, predictionValue: null },
      { rating: 1, predictionValue: null },
      { rating: -1, predictionValue: null },
      { rating: 0, predictionValue: null },
      { rating: 0, predictionValue: null },
    ])
    // 2 positive / (2 + 1) = 0.667
    expect(r.approvalRate).toBe(0.667)
  })

  it("zero approvalRate when only neutrals", () => {
    const r = aggregateFeedback([
      { rating: 0, predictionValue: null },
      { rating: 0, predictionValue: null },
    ])
    expect(r.approvalRate).toBe(0)
  })
})

describe("aggregateFeedback — adjustmentFactor", () => {
  it("full sample-size + all positive → adjustmentFactor approaches 1", () => {
    const feedbacks = Array.from({ length: MIN_SAMPLE_SIZE_FOR_CONFIDENCE }, () => ({
      rating: 1 as const,
      predictionValue: null,
    }))
    const r = aggregateFeedback(feedbacks)
    expect(r.adjustmentFactor).toBe(1)
  })

  it("full sample-size + all negative → adjustmentFactor approaches -1", () => {
    const feedbacks = Array.from({ length: MIN_SAMPLE_SIZE_FOR_CONFIDENCE }, () => ({
      rating: -1 as const,
      predictionValue: null,
    }))
    const r = aggregateFeedback(feedbacks)
    expect(r.adjustmentFactor).toBe(-1)
  })

  it("small sample size dampens adjustment factor proportionally", () => {
    // 5 ratings, all positive: avgRating=1, but credit = 5/20 = 0.25
    // → adjustmentFactor = 1 × 0.25 = 0.25
    const feedbacks = Array.from({ length: 5 }, () => ({
      rating: 1 as const,
      predictionValue: null,
    }))
    const r = aggregateFeedback(feedbacks)
    expect(r.adjustmentFactor).toBe(0.25)
  })

  it("oversampled (way above min) caps adjustmentFactor at avgRating", () => {
    const feedbacks = Array.from({ length: 500 }, () => ({
      rating: 1 as const,
      predictionValue: null,
    }))
    const r = aggregateFeedback(feedbacks)
    expect(r.adjustmentFactor).toBe(1)
  })

  it("mixed feedback at full sample size produces a small adjustment", () => {
    // 12 positive, 8 negative → avgRating = (12-8)/20 = 0.2
    // sampleSize is exactly at the threshold → credit = 1
    // → adjustmentFactor = 0.2 × 1 = 0.2
    const feedbacks: Array<{ rating: 1 | -1; predictionValue: null }> = [
      ...Array.from({ length: 12 }, () => ({ rating: 1 as const, predictionValue: null })),
      ...Array.from({ length: 8 }, () => ({ rating: -1 as const, predictionValue: null })),
    ]
    const r = aggregateFeedback(feedbacks)
    expect(r.adjustmentFactor).toBe(0.2)
  })
})

describe("aggregateFeedback — composite scenarios", () => {
  it("well-loved model: 50 ratings, 80% positive, 10% neutral, 10% negative", () => {
    const feedbacks: Array<{ rating: 1 | 0 | -1; predictionValue: null }> = [
      ...Array.from({ length: 40 }, () => ({ rating: 1 as const, predictionValue: null })),
      ...Array.from({ length: 5 }, () => ({ rating: 0 as const, predictionValue: null })),
      ...Array.from({ length: 5 }, () => ({ rating: -1 as const, predictionValue: null })),
    ]
    const r = aggregateFeedback(feedbacks)
    expect(r.sampleSize).toBe(50)
    expect(r.avgRating).toBe(0.7) // (40-5)/50
    expect(r.approvalRate).toBe(0.889) // 40/(40+5)
    // Full credit (50 >= 20), so adjustmentFactor = avgRating = 0.7
    expect(r.adjustmentFactor).toBe(0.7)
  })

  it("disaster model: 25 ratings, 90% negative", () => {
    const feedbacks: Array<{ rating: 1 | -1; predictionValue: null }> = [
      ...Array.from({ length: 22 }, () => ({ rating: -1 as const, predictionValue: null })),
      ...Array.from({ length: 3 }, () => ({ rating: 1 as const, predictionValue: null })),
    ]
    const r = aggregateFeedback(feedbacks)
    expect(r.avgRating).toBe(-0.76)
    expect(r.adjustmentFactor).toBe(-0.76)
    expect(r.approvalRate).toBe(0.12)
  })
})
