/**
 * A9 Adaptive AI Models — shared enum-as-const declarations.
 *
 * Mirrors the DB CHECK constraints in
 * `prisma/migrations/20260529160000_add_a9_ai_feedback/migration.sql`.
 * Drift between this file and the DB CHECK list surfaces as opaque
 * constraint-violation 500s — bump both in one commit.
 */

export const PREDICTION_TYPES = [
  "prediction_deal_win",
  "prediction_churn",
  "prediction_lead_score",
  "prediction_revenue_forecast",
  "recommendation_next_action",
  "chat_response",
  "content_insight",
  "custom",
] as const

export type PredictionType = (typeof PREDICTION_TYPES)[number]

/** Three-state rating taxonomy. Matches the thumbs up/down/skip UX
 *  widget on the prediction surface. */
export const RATING_VALUES = [-1, 0, 1] as const
export type Rating = (typeof RATING_VALUES)[number]

/**
 * Canonical `predictionValue` serialization rules. The DB column is
 * `String?` so each predictionType picks its own format — but slice-3
 * calibration math has to parse these uniformly, so we lock the
 * expected format here. Drift = silent calibration error.
 *
 *   prediction_deal_win        → decimal in [0,1] (e.g. "0.73" for 73%)
 *                                NOT integer-percent "73"
 *   prediction_churn           → decimal in [0,1]
 *   prediction_lead_score      → integer score (e.g. "85" on 0-100 scale)
 *   prediction_revenue_forecast→ decimal currency amount as plain string
 *                                ("125000.00") — no symbol, no thousands sep
 *   recommendation_next_action → action key (e.g. "send_followup_email")
 *   chat_response              → null typically; the response itself isn't
 *                                a numeric prediction
 *   content_insight            → decimal 0-100 score string (e.g. "67.5")
 *   custom                     → free-form, document per-customer
 */
export const PREDICTION_VALUE_FORMAT: Record<PredictionType, string> = {
  prediction_deal_win: "decimal [0,1]",
  prediction_churn: "decimal [0,1]",
  prediction_lead_score: "integer 0-100",
  prediction_revenue_forecast: "decimal currency amount",
  recommendation_next_action: "action key (string)",
  chat_response: "(null)",
  content_insight: "decimal 0-100",
  custom: "free-form",
}
