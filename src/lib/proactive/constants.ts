/**
 * T9 Proactive Service — shared constants.
 *
 * Extracted from `score-compute.ts` so both the score helper AND
 * `threshold-rules.ts` can reference the same `activityPenaltyMax`
 * without a circular import. If you tweak a weight, surface it as a
 * single intentional commit + grep callers — both helpers + their
 * test files pin specific values.
 */

/** Score weights — tuned for the 0-100 output range. */
export const SCORE_WEIGHTS = {
  /** Starting baseline; subtract penalties + add bonuses. */
  baseline: 80,
  /** churnRisk × this → subtracted. churnRisk=1 means a 50-point hit. */
  churnRiskFactor: 50,
  /** Capped engagement bonus — log-scaled so big engagement numbers
   *  don't dominate. */
  engagementCapBonus: 15,
  /** Multiplier applied to `log10(engagementScore + 1)`. Tuned so
   *  engagement=1 → ~1.81, engagement=10 → ~6.25, engagement=100 →
   *  ~12.07, engagement=1000+ → 15 (capped). */
  engagementLogMultiplier: 6,
  /** Days-since-activity penalty: 0 days → 0, 90 days → 20, capped at 30. */
  activityPenaltyMax: 30,
  activityPenaltyDaysWindow: 90,
  /** Payment overdue is a hard flag — single subtraction when true. */
  paymentOverduePenalty: 20,
  /** Contract expiring soon — softer signal. */
  contractExpiringPenalty: 10,
} as const

/** Alert threshold rules — centralised for slice-3 admin UI surfacing. */
export const THRESHOLDS = {
  /** score < this → critical churn_risk alert. */
  churnRiskCriticalScore: 30,
  /** Minimum churnRiskPenalty (factors.churnRiskPenalty >= this)
   *  required BEFORE a churn_risk alert fires — prevents low-score
   *  contacts whose drop came purely from inactivity from being
   *  flagged as churn. 50% of full churnRisk weight. */
  churnRiskMinPenalty: SCORE_WEIGHTS.churnRiskFactor * 0.5,
  /** score < this → warning health_drop alert (when no churn fires). */
  healthDropWarningScore: 55,
  /** activityPenalty > this fraction-of-max → no_activity warning. */
  noActivityPenaltyMinFraction: 0.66,
  /** paymentOverduePenalty > 0 → critical payment_overdue alert. */
  // (flag-based, no numeric threshold)
} as const
