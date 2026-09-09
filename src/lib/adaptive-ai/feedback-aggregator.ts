/**
 * A9 Adaptive AI Models — slice-1 pure aggregation helper.
 *
 * Takes a batch of `AiFeedback` rows (already pre-filtered by
 * predictionType at the caller layer) and returns per-prediction-type
 * accuracy stats. Used by:
 *
 *   - Slice-2 admin UI to render "model quality" dashboards
 *   - Slice-3 adaptive cron to adjust prediction confidence based on
 *     accumulated user feedback
 *
 * Pure: no Prisma, no fetch, no Date.now(). All inputs explicit.
 *
 * Confidence semantics: positive rating means "user agrees with the
 * prediction"; negative means "user thinks the prediction is wrong";
 * zero is "skip / no opinion". So a model is "good" when avgRating is
 * positive AND sample size is sufficient. Slice-3 adapter uses the
 * `adjustmentFactor` returned here to bias future predictions toward
 * higher-confidence ranges (when adjustmentFactor < 0, the model is
 * under-performing and slice-3 should widen confidence intervals).
 */

import type { Rating } from "./types"

export interface FeedbackRow {
  rating: Rating | number // accept number for raw DB rows; clamp at aggregation
  predictionValue: string | null
}

export interface FeedbackAggregateResult {
  /** Total feedback rows in the input. */
  sampleSize: number
  /** Count of -1 (bad). */
  negativeCount: number
  /** Count of 0 (neutral / skip). */
  neutralCount: number
  /** Count of +1 (good). */
  positiveCount: number
  /** Mean rating (-1..1). 0 when sampleSize is 0. */
  avgRating: number
  /** Approval rate = positive / (positive + negative). 0 when
   *  both counts are 0 (model has only neutral feedback or none). */
  approvalRate: number
  /** Suggested confidence adjustment factor for slice-3 adaptive
   *  cron. Range: -1..+1.
   *  -1 → model wildly off, drop confidence
   *  +1 → model very accurate, raise confidence
   *  0  → no signal (low sample size OR mixed feedback)
   *
   *  Computed as: avgRating × confidenceCredit, where
   *  confidenceCredit = min(1, sampleSize / minSampleSizeForConfidence).
   *  Low-sample sets get scaled toward 0 to avoid overcorrecting on
   *  3-rating "model is bad" panics. */
  adjustmentFactor: number
}

/** Minimum sample size before adjustmentFactor goes full-credit.
 *  Below this, the factor is scaled toward zero. */
export const MIN_SAMPLE_SIZE_FOR_CONFIDENCE = 20

function clampRating(r: number): Rating {
  if (r <= -1) return -1
  if (r >= 1) return 1
  if (r === 0) return 0
  // Defensive — fractional ratings shouldn't exist in DB (CHECK enforces
  // -1/0/+1), but if a manual SQL insert slips through, round to nearest.
  return r < 0 ? -1 : 1
}

/**
 * Aggregate a batch of feedback rows.
 *
 * @param feedbacks — already pre-filtered to a single predictionType
 *   (caller is responsible for slicing per type). Empty array is
 *   valid input — returns zeroed result.
 */
export function aggregateFeedback(feedbacks: FeedbackRow[]): FeedbackAggregateResult {
  if (feedbacks.length === 0) {
    return {
      sampleSize: 0,
      negativeCount: 0,
      neutralCount: 0,
      positiveCount: 0,
      avgRating: 0,
      approvalRate: 0,
      adjustmentFactor: 0,
    }
  }

  let negativeCount = 0
  let neutralCount = 0
  let positiveCount = 0
  let sum = 0
  for (const f of feedbacks) {
    const r = clampRating(f.rating)
    sum += r
    if (r < 0) negativeCount++
    else if (r > 0) positiveCount++
    else neutralCount++
  }

  const sampleSize = feedbacks.length
  const avgRating = sum / sampleSize
  const approvalDenominator = positiveCount + negativeCount
  const approvalRate = approvalDenominator === 0 ? 0 : positiveCount / approvalDenominator

  // Confidence credit scales with sample size — small samples are
  // unreliable, can't overcorrect from 3 votes.
  const confidenceCredit = Math.min(1, sampleSize / MIN_SAMPLE_SIZE_FOR_CONFIDENCE)
  const adjustmentFactor = avgRating * confidenceCredit

  return {
    sampleSize,
    negativeCount,
    neutralCount,
    positiveCount,
    avgRating: Math.round(avgRating * 1000) / 1000,
    approvalRate: Math.round(approvalRate * 1000) / 1000,
    adjustmentFactor: Math.round(adjustmentFactor * 1000) / 1000,
  }
}

// Re-export so the slice-2 routes + slice-3 cron can import from one barrel.
export { PREDICTION_TYPES, type PredictionType, RATING_VALUES, type Rating } from "./types"
