/**
 * Calculated Insights types — G3 Phase 6 Block B slice 1.
 *
 * Salesforce Calculated Insights analogue. Four pre-built
 * calculators ship in slice 1:
 *
 *   1. LTV (Lifetime Value) — sum-of-paid invoices in primary
 *      currency PLUS a forward-looking projection. Slice-1 projection
 *      is a simple "average-order-value × expected-remaining-orders"
 *      based on order frequency; slice-3 may swap in a survival-curve
 *      model when enough cohort data accumulates.
 *   2. Churn risk — 0..1 score. Days-since-last-seen vs the customer's
 *      OWN historical cadence: a customer who orders weekly looks
 *      churned after 3 weeks; a yearly subscriber doesn't look churned
 *      until ~14 months.
 *   3. Engagement score — 0..100. Composite of recency, frequency,
 *      and channel-breadth signals from the UnifiedProfile aggregates.
 *   4. Days-since-last-purchase — integer days since max(paidAt).
 *      Trivial metric but heavily used by slice-2 admin list views
 *      ("stale leads sorted by days_since") and G4 segmentation.
 *
 * Each calculator emits `{value, confidence, metadata}`:
 *   - value: the numeric insight
 *   - confidence: 0..1 — lower when input data is sparse
 *   - metadata: input snapshot for explainability (slice-2 admin UI
 *     renders this to answer "why does Claude say my customer's LTV
 *     is $1,200?")
 */

/* ─── Pre-built insight key registry ──────────────────────────────────── */

/**
 * Tuple of pre-built insight keys — single source of truth. Adding a
 * new calculator: (1) extend this tuple, (2) write the calculator,
 * (3) register in `INSIGHT_VALUE_TYPES` below, (4) ship a slice-2
 * cron handler that dispatches by key.
 */
export const PREBUILT_INSIGHT_KEYS = [
  "ltv",
  "churn_risk",
  "engagement_score",
  "days_since_last_purchase",
] as const

export type PrebuiltInsightKey = (typeof PREBUILT_INSIGHT_KEYS)[number]

/**
 * Display-formatting hint that the slice-2 admin UI consumes. Matches
 * the DB CHECK on `calculated_insight_defs.valueType`.
 */
export const INSIGHT_VALUE_TYPES = ["currency", "percentage", "score", "days", "count"] as const

export type InsightValueType = (typeof INSIGHT_VALUE_TYPES)[number]

/**
 * Per-pre-built-insight value-type mapping. Slice-2 seed migration
 * upserts default `calculated_insight_defs` rows per tenant using this
 * map; the helper-side ensures definition consistency.
 */
export const PREBUILT_INSIGHT_VALUE_TYPES: Readonly<
  Record<PrebuiltInsightKey, InsightValueType>
> = {
  ltv: "currency",
  churn_risk: "percentage", // 0..1 stored, rendered as %
  engagement_score: "score", // 0..100 stored
  days_since_last_purchase: "days",
}

/* ─── Calculator I/O shapes ───────────────────────────────────────────── */

/**
 * Input snapshot from a UnifiedProfile + its primary-contact's
 * recent invoices. Loose-typed — caller can pass the relevant
 * subset of G1 aggregates + raw invoice data.
 */
export interface CalculatorInputProfile {
  totalSpent: number
  lifetimeOrderCount: number
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  /** Channel tags array — matches `UnifiedProfile.channelsActive` Postgres TEXT[]. */
  channelsActive: readonly string[]
}

export interface CalculatorInputInvoice {
  /** Invoice paid timestamp. Slice-2 caller pre-filters to paidAt only. */
  paidAt: Date
  totalAmount: number
}

export interface CalculatorInput {
  profile: CalculatorInputProfile
  /** Sorted ASC by paidAt — caller passes pre-sorted to avoid double-sorting. */
  invoices: readonly CalculatorInputInvoice[]
  /** Caller-supplied (testability). Defaults to `now()` inside the calculator. */
  asOf?: Date
}

/* ─── Calculator outputs ──────────────────────────────────────────────── */

export interface CalculatorOutput {
  /** Numeric insight value — range depends on the calculator. */
  value: number
  /** 0..1 confidence — sparse-data calculators emit < 1. */
  confidence: number
  /**
   * Input-snapshot metadata for explainability. Each calculator
   * documents its keys.
   */
  metadata: Record<string, unknown>
}

/* ─── Confidence floors / caps ────────────────────────────────────────── */

/**
 * Minimum data points a calculator needs to emit confidence == 1.0.
 * Below these counts the calculator scales confidence down linearly
 * (or to 0 for completely empty input).
 *
 * NB — `days_since_last_purchase` is intentionally absent: it's a
 * binary-confidence calculator (0 paid invoices → conf=0; ≥ 1 paid
 * invoice → conf=1; future paidAt → conf=0 via the clock-skew clamp).
 * Slice-2 cron must NOT add a "throw on missing key" guard here.
 */
export const CONFIDENCE_DATAPOINT_THRESHOLDS = {
  /** LTV needs at least 3 paid invoices to be confident. */
  ltv: 3,
  /** Churn risk needs at least 2 paid invoices to estimate cadence. */
  churn_risk: 2,
  /** Engagement score needs only 1 channel signal to be 0.5+ confident. */
  engagement_score: 1,
} as const
