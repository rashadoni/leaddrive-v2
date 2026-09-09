/**
 * A9 Adaptive AI Models — slice-3 adjustment apply tests.
 *
 * Pure-compute tests for `applyAdjustment`. The DB-touching
 * `getAdjustment` is exercised through the cron + engine integration
 * tests (`api-adaptive-ai-refresh.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiPredictionAdjustment: { findUnique: vi.fn() },
  },
}))

import {
  applyAdjustment,
  getAdjustment,
  ADJUSTMENT_STALE_AFTER_MS,
  MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS,
  type AdjustmentRow,
} from "@/lib/adaptive-ai/adjustments"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
})

function row(
  overrides: Partial<AdjustmentRow> = {},
): AdjustmentRow {
  return {
    organizationId: "org1",
    predictionType: "prediction_deal_win",
    adjustmentFactor: 0,
    sampleSize: 50, // well above MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS
    avgRating: 0,
    approvalRate: 0,
    lastComputedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

describe("applyAdjustment — null adjustment", () => {
  it("returns raw unchanged when adj is null (no cron run yet)", () => {
    expect(applyAdjustment(0.5, null, { maxNudge: 0.1 })).toBe(0.5)
    expect(applyAdjustment(75, null, { maxNudge: 0.1, max: 100 })).toBe(75)
  })
})

describe("applyAdjustment — sample-size gate", () => {
  it("returns raw unchanged when sampleSize is below the engine-bias threshold", () => {
    const r = row({ sampleSize: MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS - 1, adjustmentFactor: 1 })
    expect(applyAdjustment(0.5, r, { maxNudge: 0.1 })).toBe(0.5)
  })

  it("applies adjustment at exactly the threshold", () => {
    const r = row({ sampleSize: MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS, adjustmentFactor: 1 })
    const result = applyAdjustment(0.5, r, { maxNudge: 0.1 })
    expect(result).toBeCloseTo(0.55, 4)
  })
})

describe("applyAdjustment — proportional nudge", () => {
  it("scales nudge to raw value (high values move more in absolute terms)", () => {
    const r = row({ adjustmentFactor: 1 })
    const low = applyAdjustment(0.1, r, { maxNudge: 0.1 })
    const high = applyAdjustment(0.9, r, { maxNudge: 0.1 })
    // low: 0.1 + (0.1 × 1 × 0.1) = 0.11   → +0.01 absolute
    // high: 0.9 + (0.9 × 1 × 0.1) = 0.99  → +0.09 absolute
    expect(low).toBeCloseTo(0.11, 4)
    expect(high).toBeCloseTo(0.99, 4)
  })

  it("negative adjustmentFactor pulls value down", () => {
    const r = row({ adjustmentFactor: -1 })
    const result = applyAdjustment(0.5, r, { maxNudge: 0.1 })
    expect(result).toBeCloseTo(0.45, 4)
  })

  it("zero adjustmentFactor is identity", () => {
    const r = row({ adjustmentFactor: 0 })
    expect(applyAdjustment(0.5, r, { maxNudge: 0.1 })).toBe(0.5)
  })

  it("partial adjustmentFactor scales proportionally", () => {
    const r = row({ adjustmentFactor: 0.5 })
    const result = applyAdjustment(0.5, r, { maxNudge: 0.1 })
    // 0.5 + (0.5 × 0.5 × 0.1) = 0.525
    expect(result).toBeCloseTo(0.525, 4)
  })
})

describe("applyAdjustment — clamp bounds", () => {
  it("clamps high raw values to opts.max", () => {
    const r = row({ adjustmentFactor: 1 })
    // 0.95 + (0.95 × 1 × 0.10) = 1.045 → clamped to 1.0
    expect(applyAdjustment(0.95, r, { maxNudge: 0.1 })).toBe(1)
  })

  it("clamps low raw values to opts.min", () => {
    const r = row({ adjustmentFactor: -1 })
    // 0.03 + (0.03 × -1 × 1.5) = -0.015 → clamped to 0
    expect(applyAdjustment(0.03, r, { maxNudge: 1.5 })).toBe(0)
  })

  it("respects custom min/max bounds", () => {
    const r = row({ adjustmentFactor: 1 })
    // raw=80 on 0-100 scale, +10% → 88 (no clamp needed)
    expect(applyAdjustment(80, r, { maxNudge: 0.1, max: 100 })).toBe(88)
    // raw=95 on 0-100 scale, +10% → 104.5 → clamped to 100
    expect(applyAdjustment(95, r, { maxNudge: 0.1, max: 100 })).toBe(100)
  })

  it("default bounds are [0, 1]", () => {
    const r = row({ adjustmentFactor: 1 })
    expect(applyAdjustment(2, r, { maxNudge: 0.1 })).toBe(1)
  })
})

describe("applyAdjustment — Decimal precision integration", () => {
  it("handles realistic Decimal-as-number inputs from the DB", () => {
    // Decimal(6,4) → Number conversion guarantees ≤4 decimals.
    const r = row({ adjustmentFactor: 0.3333 })
    const result = applyAdjustment(0.5, r, { maxNudge: 0.1 })
    // 0.5 + (0.5 × 0.3333 × 0.1) = 0.516665
    expect(result).toBeCloseTo(0.51665, 4)
  })
})

describe("getAdjustment — DB read + staleness gate", () => {
  it("returns null when no row exists", async () => {
    vi.mocked(prisma.aiPredictionAdjustment.findUnique).mockResolvedValue(null)
    const result = await getAdjustment("org1", "prediction_deal_win")
    expect(result).toBeNull()
  })

  it("returns null when the row is older than the staleness window", async () => {
    // 31 days old — past the 30-day stale threshold.
    const staleDate = new Date(Date.now() - ADJUSTMENT_STALE_AFTER_MS - 86400_000)
    vi.mocked(prisma.aiPredictionAdjustment.findUnique).mockResolvedValue({
      id: "adj1",
      organizationId: "org1",
      predictionType: "prediction_deal_win",
      adjustmentFactor: "0.5" as any, // Decimal
      sampleSize: 50,
      avgRating: "0.5" as any,
      approvalRate: "0.8" as any,
      lastComputedAt: staleDate,
      createdAt: staleDate,
    } as any)
    const result = await getAdjustment("org1", "prediction_deal_win")
    expect(result).toBeNull()
  })

  it("returns the row when fresh + parses Decimals to numbers", async () => {
    const freshDate = new Date(Date.now() - 60_000) // 1 min ago
    vi.mocked(prisma.aiPredictionAdjustment.findUnique).mockResolvedValue({
      id: "adj1",
      organizationId: "org1",
      predictionType: "prediction_deal_win",
      adjustmentFactor: "0.42" as any,
      sampleSize: 50,
      avgRating: "0.7" as any,
      approvalRate: "0.85" as any,
      lastComputedAt: freshDate,
      createdAt: freshDate,
    } as any)
    const result = await getAdjustment("org1", "prediction_deal_win")
    expect(result).not.toBeNull()
    expect(result?.adjustmentFactor).toBe(0.42)
    expect(result?.sampleSize).toBe(50)
    expect(result?.avgRating).toBe(0.7)
    expect(result?.approvalRate).toBe(0.85)
  })

  it("scopes the lookup by composite key (organizationId, predictionType)", async () => {
    vi.mocked(prisma.aiPredictionAdjustment.findUnique).mockResolvedValue(null)
    await getAdjustment("org42", "prediction_churn")
    expect(prisma.aiPredictionAdjustment.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_predictionType: {
          organizationId: "org42",
          predictionType: "prediction_churn",
        },
      },
    })
  })
})
