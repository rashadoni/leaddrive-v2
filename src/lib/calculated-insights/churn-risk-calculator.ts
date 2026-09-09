/**
 * Churn risk calculator — G3 Phase 6 Block B slice 1.
 *
 * Computes a 0..1 churn-risk score based on the customer's OWN
 * historical ordering cadence vs how long it's been since their
 * last order:
 *
 *   averageDaysBetweenOrders = sum(gap_i) / (orderCount - 1)
 *   daysSinceLastOrder = now - lastPaidAt
 *   risk = clamp(daysSinceLastOrder / (averageDaysBetweenOrders × 3), 0, 1)
 *
 * Why 3×: a customer who orders every 30 days but hasn't ordered in
 * 90 days has gone three full cycles — that's the inflection point
 * where most retention curves call churn. Beyond 3× the cadence,
 * risk saturates at 1.0.
 *
 * Confidence scaling:
 *   - >= 2 paid invoices: confidence = 1.0 (need 2 to compute a gap)
 *   - < 2 paid invoices: confidence = 0 (no cadence data)
 *
 * Pure synchronous.
 */
import {
  CONFIDENCE_DATAPOINT_THRESHOLDS,
  type CalculatorInput,
  type CalculatorOutput,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const CHURN_INFLECTION_MULTIPLIER = 3

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function calculateChurnRisk(input: CalculatorInput): CalculatorOutput {
  const { invoices } = input
  const asOf = input.asOf ?? new Date()

  // Defensive: caller pre-sorts ASC by paidAt; re-sort here so a
  // future caller-side regression doesn't corrupt the cadence math.
  const sorted = invoices
    .filter(
      (i) =>
        i.paidAt instanceof Date &&
        Number.isFinite(i.totalAmount) &&
        i.totalAmount > 0
    )
    .slice()
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())

  const threshold = CONFIDENCE_DATAPOINT_THRESHOLDS.churn_risk
  if (sorted.length < threshold) {
    return {
      value: 0,
      confidence: 0,
      metadata: {
        reason: "insufficient_data_for_cadence",
        paidInvoiceCount: sorted.length,
        requiredMinimum: threshold,
      },
    }
  }

  // Compute average gap between consecutive paid invoices (in days).
  let totalGapMs = 0
  for (let i = 1; i < sorted.length; i++) {
    totalGapMs += sorted[i].paidAt.getTime() - sorted[i - 1].paidAt.getTime()
  }
  const averageGapMs = totalGapMs / (sorted.length - 1)
  const averageGapDays = averageGapMs / MS_PER_DAY

  // Time since last order.
  const lastOrderAt = sorted[sorted.length - 1].paidAt
  const daysSinceLast = (asOf.getTime() - lastOrderAt.getTime()) / MS_PER_DAY

  // Edge case: averageGapMs === 0 (multiple orders at the same
  // timestamp). Treat as "very frequent buyer" → risk = 0 with a
  // metadata note. Slice-3 may revisit if intraday bursts are common
  // (e.g. ecommerce flash sale).
  if (averageGapMs <= 0) {
    return {
      value: 0,
      confidence: 1,
      metadata: {
        reason: "zero_average_gap_treated_as_zero_risk",
        averageGapDays: 0,
        daysSinceLast: round2(daysSinceLast),
      },
    }
  }

  const inflectionDays = averageGapDays * CHURN_INFLECTION_MULTIPLIER
  const risk = clamp01(daysSinceLast / inflectionDays)

  return {
    value: round2(risk),
    confidence: 1,
    metadata: {
      averageGapDays: round2(averageGapDays),
      daysSinceLast: round2(daysSinceLast),
      inflectionDays: round2(inflectionDays),
      paidInvoiceCount: sorted.length,
    },
  }
}
