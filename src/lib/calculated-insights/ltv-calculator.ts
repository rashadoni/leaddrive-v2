/**
 * LTV (Lifetime Value) calculator — G3 Phase 6 Block B slice 1.
 *
 * Computes historical LTV (sum of paid invoices) PLUS a simple
 * forward-looking projection based on the customer's own order
 * cadence:
 *
 *   historicalLTV = totalSpent (from G1 aggregate)
 *   averageOrderValue = totalSpent / lifetimeOrderCount
 *   ordersPerMonth = lifetimeOrderCount / monthsSinceFirstSeen
 *   expectedRemainingMonths = max(0, EXPECTED_LIFETIME_MONTHS - monthsSinceFirstSeen)
 *   projectedLTV = historicalLTV + (averageOrderValue × ordersPerMonth × expectedRemainingMonths)
 *
 * Slice-1 assumes a 36-month expected customer lifetime — a SaaS
 * convention. Slice-3 will swap to survival-curve modeling when
 * cohort data accumulates.
 *
 * Confidence scaling:
 *   - >= 3 paid invoices: confidence = 1.0
 *   - < 3 paid invoices: confidence = orderCount / 3 (linear scale)
 *   - 0 invoices: confidence = 0, value = 0
 *
 * Pure synchronous.
 */
import {
  CONFIDENCE_DATAPOINT_THRESHOLDS,
  type CalculatorInput,
  type CalculatorOutput,
} from "./types"

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000
const EXPECTED_LIFETIME_MONTHS = 36

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateLtv(input: CalculatorInput): CalculatorOutput {
  const { profile, invoices } = input
  const asOf = input.asOf ?? new Date()

  // Filter to paid invoices with positive amounts. Caller pre-filters
  // by `status='paid'` upstream; this defensive guard catches a future
  // upstream regression.
  const paidInvoices = invoices.filter(
    (i) =>
      i.paidAt instanceof Date &&
      Number.isFinite(i.totalAmount) &&
      i.totalAmount > 0
  )

  const paidCount = paidInvoices.length
  const historicalLTV = round2(
    paidInvoices.reduce((sum, i) => sum + i.totalAmount, 0)
  )

  if (paidCount === 0) {
    return {
      value: 0,
      confidence: 0,
      metadata: {
        reason: "no_paid_invoices",
        historicalLTV: 0,
        projectedLTV: 0,
      },
    }
  }

  const averageOrderValue = historicalLTV / paidCount

  // Compute months-since-first-seen. Prefer profile.firstSeenAt; fall
  // back to the earliest paid-invoice timestamp.
  const firstSignal =
    profile.firstSeenAt instanceof Date
      ? profile.firstSeenAt
      : paidInvoices[0].paidAt
  const monthsSinceFirstSeen = Math.max(
    0,
    (asOf.getTime() - firstSignal.getTime()) / MS_PER_MONTH
  )

  // Avoid divide-by-zero on a customer who placed multiple orders
  // today (monthsSinceFirstSeen < 1). Clamp to 1-month minimum so
  // the cadence calculation produces a finite number.
  const effectiveMonths = Math.max(1, monthsSinceFirstSeen)
  const ordersPerMonth = paidCount / effectiveMonths
  const expectedRemainingMonths = Math.max(
    0,
    EXPECTED_LIFETIME_MONTHS - monthsSinceFirstSeen
  )

  const projectedLTV = round2(
    historicalLTV + averageOrderValue * ordersPerMonth * expectedRemainingMonths
  )

  // Confidence scaling — see header comment.
  const threshold = CONFIDENCE_DATAPOINT_THRESHOLDS.ltv
  const confidence = paidCount >= threshold ? 1 : paidCount / threshold

  return {
    value: projectedLTV,
    confidence: round2(confidence),
    metadata: {
      historicalLTV,
      projectedLTV,
      averageOrderValue: round2(averageOrderValue),
      ordersPerMonth: round2(ordersPerMonth),
      monthsSinceFirstSeen: round2(monthsSinceFirstSeen),
      expectedRemainingMonths: round2(expectedRemainingMonths),
      paidInvoiceCount: paidCount,
      // Echo the lifetime horizon used — slice-2 admin UI surfaces this
      // so clients can defend the projection ("we assumed a 36-month
      // customer lifetime"). Slice-2 will swap to per-tenant override
      // from `CalculatedInsightDef.params`.
      expectedLifetimeMonths: EXPECTED_LIFETIME_MONTHS,
    },
  }
}
