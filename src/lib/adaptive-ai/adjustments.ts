/**
 * A9 Adaptive AI Models — slice-3 adjustment retrieval + apply.
 *
 * Engines that emit predictions read the current adjustment factor for
 * their predictionType and call `applyAdjustment` on the raw model
 * output:
 *
 *   const adj = await getAdjustment(orgId, "prediction_deal_win")
 *   const adjusted = applyAdjustment(rawWinProb, adj, { maxNudge: 0.10 })
 *
 * Design:
 * - Pure compute (`applyAdjustment`) separated from IO (`getAdjustment`)
 *   so the math can be unit-tested without a DB.
 * - `maxNudge` clamps the effect — the cron's adjustmentFactor ranges
 *   over [-1, 1], but a 100% swing on a probability is far too
 *   aggressive. Each engine picks a conservative per-prediction-type
 *   maxNudge (deal-win uses 0.10 = ±10% swing).
 * - Bounded output: probability adjustments are clamped to [0, 1]
 *   (or [0, 100] in integer-percent space).
 */

import { prisma } from "@/lib/prisma"
import type { PredictionType } from "./types"

export interface AdjustmentRow {
  organizationId: string
  predictionType: PredictionType
  adjustmentFactor: number // Decimal from DB, cast to number
  sampleSize: number
  avgRating: number
  approvalRate: number
  lastComputedAt: Date
}

/** Staleness window — adjustments older than this are treated as
 *  if no row exists. Without this the last computed adjustment
 *  would persist indefinitely after feedback rate drops to zero,
 *  biasing predictions against current reality. 30 days is a
 *  conservative cushion against weekly + monthly review cadences. */
export const ADJUSTMENT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Read the current adjustment for an (org, predictionType) pair.
 * Returns null when no row exists yet (cron hasn't run, no feedback
 * accumulated, etc.) OR the row is stale beyond
 * `ADJUSTMENT_STALE_AFTER_MS`. Callers MUST handle null →
 * no adjustment.
 */
export async function getAdjustment(
  orgId: string,
  predictionType: PredictionType,
): Promise<AdjustmentRow | null> {
  const row = await prisma.aiPredictionAdjustment.findUnique({
    where: {
      organizationId_predictionType: { organizationId: orgId, predictionType },
    },
  })
  if (!row) return null

  const ageMs = Date.now() - row.lastComputedAt.getTime()
  if (ageMs > ADJUSTMENT_STALE_AFTER_MS) return null

  return {
    organizationId: row.organizationId,
    predictionType: row.predictionType as PredictionType,
    adjustmentFactor: Number(row.adjustmentFactor),
    sampleSize: row.sampleSize,
    avgRating: Number(row.avgRating),
    approvalRate: Number(row.approvalRate),
    lastComputedAt: row.lastComputedAt,
  }
}

/** Minimum sample size below which adjustments are ignored entirely.
 *  Mirrors slice-1's MIN_SAMPLE_SIZE_FOR_CONFIDENCE but applied as a
 *  hard gate here (slice-1 dampens via factor; slice-3 outright
 *  ignores below threshold for engine-bias purposes). */
export const MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS = 5

export interface ApplyOpts {
  /** Maximum proportional nudge applied to the raw value. Engines pick
   *  conservative caps per predictionType. */
  maxNudge: number
  /** Lower clamp bound for the adjusted value (default 0). */
  min?: number
  /** Upper clamp bound for the adjusted value (default 1). */
  max?: number
}

/**
 * Apply an adjustment to a raw prediction value.
 *
 *   adjusted = raw + (raw × adjustmentFactor × maxNudge)
 *
 * Examples (raw=0.50, maxNudge=0.10):
 *   adj.adjustmentFactor =  1.0 → adjusted = 0.50 + 0.05 = 0.55  (+10%)
 *   adj.adjustmentFactor =  0.5 → adjusted = 0.50 + 0.025 = 0.525 (+5%)
 *   adj.adjustmentFactor = -1.0 → adjusted = 0.50 - 0.05 = 0.45  (-10%)
 *   adj.adjustmentFactor =  0   → adjusted = 0.50               (no change)
 *
 * Why proportional rather than additive: a 10% nudge to a 0.10
 * probability (low-confidence prediction) should move it less in
 * absolute terms than a 0.90 probability — otherwise small
 * predictions get over-corrected.
 *
 * Returns the raw value untouched when:
 *   - adj is null (no row yet)
 *   - adj.sampleSize < MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS
 */
export function applyAdjustment(
  raw: number,
  adj: AdjustmentRow | null,
  opts: ApplyOpts,
): number {
  if (adj === null) return raw
  if (adj.sampleSize < MIN_SAMPLE_SIZE_FOR_ENGINE_BIAS) return raw

  const min = opts.min ?? 0
  const max = opts.max ?? 1
  const nudge = raw * adj.adjustmentFactor * opts.maxNudge
  const adjusted = raw + nudge

  if (adjusted < min) return min
  if (adjusted > max) return max
  return adjusted
}
