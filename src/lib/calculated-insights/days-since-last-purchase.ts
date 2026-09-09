/**
 * Days-since-last-purchase calculator — G3 Phase 6 Block B slice 1.
 *
 * Simple metric. Returns the integer days since the customer's most
 * recent paid invoice.
 *
 *   - 0 paid invoices: value = 0, confidence = 0
 *   - >= 1 paid invoice: value = floor(daysSince(maxPaidAt)), confidence = 1
 *
 * Pure synchronous. Used by:
 *   • slice-2 admin UI list view ("Stale leads sorted by days_since")
 *   • slice-2 G4 segmentation ("re-engage anyone with days_since > 60")
 *   • slice-3 churn-risk crosscheck
 */
import type { CalculatorInput, CalculatorOutput } from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function calculateDaysSinceLastPurchase(
  input: CalculatorInput
): CalculatorOutput {
  const { invoices } = input
  const asOf = input.asOf ?? new Date()

  const paid = invoices.filter(
    (i) =>
      i.paidAt instanceof Date &&
      Number.isFinite(i.totalAmount) &&
      i.totalAmount > 0
  )

  if (paid.length === 0) {
    return {
      value: 0,
      confidence: 0,
      metadata: {
        reason: "no_paid_invoices",
        paidInvoiceCount: 0,
      },
    }
  }

  // Find max paidAt timestamp.
  let maxPaidAt = paid[0].paidAt
  for (let i = 1; i < paid.length; i++) {
    if (paid[i].paidAt.getTime() > maxPaidAt.getTime()) {
      maxPaidAt = paid[i].paidAt
    }
  }

  const diffMs = asOf.getTime() - maxPaidAt.getTime()
  // Negative diff (paidAt in the future — clock skew on a POS terminal,
  // a test fixture that landed in prod, etc.). Clamp value=0 AND drop
  // confidence to 0 — downstream segmentation `WHERE value > 60 AND
  // confidence > 0.5` will then correctly exclude these rows (instead
  // of silently treating them as "0 days since purchase = very active").
  if (diffMs < 0) {
    return {
      value: 0,
      confidence: 0,
      metadata: {
        reason: "future_paid_at_clamped",
        paidInvoiceCount: paid.length,
        maxPaidAt: maxPaidAt.toISOString(),
      },
    }
  }

  const days = Math.floor(diffMs / MS_PER_DAY)

  return {
    value: days,
    confidence: 1,
    metadata: {
      paidInvoiceCount: paid.length,
      maxPaidAt: maxPaidAt.toISOString(),
    },
  }
}
