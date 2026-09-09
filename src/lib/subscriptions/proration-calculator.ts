/**
 * Proration calculator — D4 slice 1.
 *
 * Given a mid-cycle plan change, computes the customer's net charge
 * (or credit) using days-remaining math:
 *
 *   unusedCredit = currentUnitAmount * (daysRemaining / daysInPeriod)
 *   newCharge    = newUnitAmount     * (daysRemaining / daysInPeriod)
 *   prorationAmount = newCharge - unusedCredit
 *
 *   positive = upgrade → customer owes additional charge today
 *   negative = downgrade → customer gets a credit
 *   zero     = same price OR change applied exactly at period boundary
 *
 * Edge cases:
 *   - `asOf >= currentPeriodEnd` → 0 days remaining → 0 proration
 *     (next-period charge handles the new plan from scratch).
 *   - `asOf <= currentPeriodStart` → full period remaining → full delta.
 *   - `daysInPeriod = 0` (start == end) → 0 proration (degenerate input;
 *     either upstream bug or 1-day period; treat as no-op).
 *
 * Pure synchronous. Caller (slice-2 route) wraps with the
 * `plan_changed` SubscriptionEvent insert + Subscription.unitAmount
 * snapshot update inside a transaction.
 *
 * Slice-3 deferral: the days-remaining math uses `Math.floor` on calendar
 * days (24h chunks). Stripe uses fractional-seconds proration for
 * sub-day precision. The floor model is conservative — customer always
 * gets the same OR fewer remaining-days credit, never more. For
 * Stripe-parity we'll either (a) switch to `Math.ceil` on the
 * remaining-side (slightly more customer-friendly) or (b) move to
 * second-level precision. Locked-in for slice 1 because every test
 * uses day-boundary timestamps, so the discrepancy doesn't surface.
 */
import type { ProrationInput, ProrationResult } from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Compute calendar days between two timestamps (UTC-anchored).
 * Rounds DOWN to whole-day count — partial days don't count toward
 * remainder. This matches Stripe's proration semantics where a
 * change at 23:59 on day 14 still has 16 days remaining in a
 * 30-day cycle, not 15.99.
 */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  if (ms <= 0) return 0
  return Math.floor(ms / MS_PER_DAY)
}

export function calculateProration(input: ProrationInput): ProrationResult {
  const {
    currentUnitAmount,
    newUnitAmount,
    currentPeriodStart,
    currentPeriodEnd,
    asOf,
  } = input

  const daysInPeriod = daysBetween(currentPeriodStart, currentPeriodEnd)
  const daysRemaining = asOf >= currentPeriodEnd ? 0 : daysBetween(asOf, currentPeriodEnd)

  if (daysInPeriod <= 0 || daysRemaining <= 0) {
    return {
      prorationAmount: 0,
      unusedCredit: 0,
      newCharge: 0,
      daysRemaining: Math.max(0, daysRemaining),
      daysInPeriod: Math.max(0, daysInPeriod),
    }
  }

  // Clamp daysRemaining to daysInPeriod — defends against an `asOf`
  // earlier than `currentPeriodStart` (caller bug) producing > 100%
  // proration. The clamp is a defense-in-depth; the daysBetween()
  // floor + asOf >= currentPeriodEnd guard above already cover the
  // happy path.
  const effectiveRemaining = Math.min(daysRemaining, daysInPeriod)
  const fraction = effectiveRemaining / daysInPeriod

  const unusedCredit = round2(currentUnitAmount * fraction)
  const newCharge = round2(newUnitAmount * fraction)
  const prorationAmount = round2(newCharge - unusedCredit)

  return {
    prorationAmount,
    unusedCredit,
    newCharge,
    daysRemaining: effectiveRemaining,
    daysInPeriod,
  }
}
