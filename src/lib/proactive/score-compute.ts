/**
 * T9 Proactive Service — slice-1 pure compute helper.
 *
 * Takes the existing signals already computed elsewhere in the system
 * (churnRisk 0..1 from `/api/v1/calculated-insights`, engagementScore
 * 0..N+ from the marketing layer, last activity timestamp from
 * `Activity`) and returns a 0-100 health score plus a factors
 * breakdown for the UI's "why this score" panel.
 *
 * Pure: no Prisma, no fetch, no Date.now(). All inputs explicit. Makes
 * the slice-2 refresh cron testable end-to-end by mocking only the
 * Prisma layer.
 *
 * Score model: simple linear combination clamped to 0-100. The factors
 * object is the same structure the migration's `factors` Json column
 * stores, so the UI can render it without a second computation.
 */

export interface HealthScoreInput {
  /** Existing churn risk score 0..1 from calculated-insights. 0 = healthy, 1 = about to churn. */
  churnRisk: number
  /** Existing engagement score (raw). Higher = more engaged. */
  engagementScore: number
  /** Days since last touchpoint — call, email, meeting, login. */
  daysSinceLastActivity: number
  /** Optional payment-overdue flag — `true` adds a hard penalty. */
  paymentOverdue?: boolean
  /** Optional contract-expiring-soon flag — `true` reduces by a small amount. */
  contractExpiringSoon?: boolean
}

export interface HealthScoreResult {
  /** Final 0-100 score (higher = healthier). */
  score: number
  /** Breakdown for the UI — keys mirror HealthScoreInput plus computed deltas. */
  factors: {
    churnRiskPenalty: number
    engagementBonus: number
    activityPenalty: number
    paymentOverduePenalty: number
    contractExpiringPenalty: number
    baseline: number
  }
}

// SCORE_WEIGHTS moved to `./constants.ts` so threshold-rules.ts can
// reference `activityPenaltyMax` without a circular import.
// Re-exported here for backwards compat with callers that imported
// from this file (e.g. tests + slice-3 admin UI surfacing).
import { SCORE_WEIGHTS } from "./constants"
export { SCORE_WEIGHTS }

/**
 * Pure score computation. Inputs are signals from elsewhere in the
 * system; output is the persisted shape ready for `prisma.healthScore.upsert`.
 *
 * Clamping: result.score is forced into [0, 100]. Factors are returned
 * unclamped so the UI can show "would have been -15 but clamped to 0".
 */
export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const W = SCORE_WEIGHTS

  // Clamp churnRisk into [0, 1] so a wild input doesn't blow the score.
  const churnClamped = Math.max(0, Math.min(1, input.churnRisk))
  const churnRiskPenalty = churnClamped * W.churnRiskFactor

  // Engagement bonus: log-scaled — 1 → ~1.81, 10 → ~6.25, 100 → ~12.07,
  // 1000+ → 15 (capped). Negative engagement clamps to 0 bonus.
  const engagementBonus =
    input.engagementScore <= 0
      ? 0
      : Math.min(
          W.engagementCapBonus,
          Math.log10(input.engagementScore + 1) * W.engagementLogMultiplier,
        )

  // Activity penalty: linear from 0 (today) to max at the configured
  // window (default 90 days). Beyond the window stays at max.
  const daysClamped = Math.max(0, input.daysSinceLastActivity)
  const activityPenalty = Math.min(
    W.activityPenaltyMax,
    (daysClamped / W.activityPenaltyDaysWindow) * W.activityPenaltyMax,
  )

  const paymentOverduePenalty = input.paymentOverdue ? W.paymentOverduePenalty : 0
  const contractExpiringPenalty = input.contractExpiringSoon ? W.contractExpiringPenalty : 0

  const raw =
    W.baseline -
    churnRiskPenalty +
    engagementBonus -
    activityPenalty -
    paymentOverduePenalty -
    contractExpiringPenalty

  const score = Math.max(0, Math.min(100, Math.round(raw)))

  return {
    score,
    factors: {
      churnRiskPenalty: Math.round(churnRiskPenalty * 100) / 100,
      engagementBonus: Math.round(engagementBonus * 100) / 100,
      activityPenalty: Math.round(activityPenalty * 100) / 100,
      paymentOverduePenalty,
      contractExpiringPenalty,
      baseline: W.baseline,
    },
  }
}
