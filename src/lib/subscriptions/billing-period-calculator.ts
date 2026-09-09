/**
 * Billing-period calculator — D4 slice 1.
 *
 * Given an anchor date + (interval, count), produces the next period's
 * (start, end, nextBillingAt). Used by:
 *   - Subscription create: anchor = now() → produces the FIRST period.
 *   - Period rollover: anchor = currentPeriodEnd → next period.
 *   - Trial conversion: anchor = trialEndsAt → first paid period.
 *
 * Semantics:
 *   start = anchor (the new period begins exactly at the anchor — no
 *           dead time between periods).
 *   end   = start + (interval × count), computed in calendar units
 *           (month/year aware of variable-length months).
 *   nextBillingAt = start (Stripe convention — charge at period start).
 *
 * Calendar awareness:
 *   - "day"  → straight ms addition (60s × 60m × 24h × N).
 *   - "week" → 7-day ms addition × N.
 *   - "month"/"year" → custom clamp logic in addMonthsClamped(). JS
 *     native `Date.setUTCMonth` does NOT clamp month-end overflow —
 *     Jan 31 + 1 month becomes Mar 3 (Feb has 28 days; the spillover
 *     lands on Mar 3). Stripe's billing convention is to clamp to
 *     the last day of the target month (Jan 31 → Feb 28/29). The
 *     helper does this explicitly so subscribers anchored on
 *     29/30/31 don't silently mis-bill.
 *
 * The clamp keeps anchor-day "stickiness": Jan 31 → Feb 28 → Mar 28
 * → Apr 28 → May 28 → … (clamping locks the anchor to Feb 28 for
 * the rest of the year). Callers that want "always end of month"
 * should anchor on day 1 of the FOLLOWING month and subtract a day
 * downstream, rather than expect this helper to do it.
 */
import type {
  BillingIntervalConfig,
  InitialPeriodInput,
  InitialPeriodResult,
  NextPeriodInput,
  NextPeriodResult,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Add `count` months to `anchor`, clamping the day-of-month to the
 * target month's last day. This is the Stripe-style billing convention:
 *
 *   Jan 31 + 1 month → Feb 28 (non-leap) / Feb 29 (leap)
 *   Mar 31 + 1 month → Apr 30
 *   May 31 + 1 month → Jun 30
 *
 * Native JS `Date.setUTCMonth` does NOT clamp — it overflows
 * (Jan 31 + 1 month → Mar 3, because Feb has 28 days and the
 * spillover lands on Mar 3). Used naively, that would silently
 * mis-bill anyone whose anchor day is 29/30/31.
 */
function addMonthsClamped(anchor: Date, count: number): Date {
  const targetMonthRaw = anchor.getUTCMonth() + count
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonthRaw / 12)
  const targetMonth = ((targetMonthRaw % 12) + 12) % 12
  // Last day of target month = day 0 of (target month + 1).
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate()
  const day = Math.min(anchor.getUTCDate(), lastDayOfTargetMonth)
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds()
    )
  )
}

function addInterval(anchor: Date, config: BillingIntervalConfig): Date {
  const { billingInterval: interval, billingIntervalCount: count } = config
  if (count <= 0 || !Number.isInteger(count)) {
    // Bubble up to a caller-side check; the result is undefined at this point.
    // The migration enforces count > 0 at the DB level, so this is defensive.
    return new Date(anchor.getTime())
  }

  switch (interval) {
    case "day":
      return new Date(anchor.getTime() + count * MS_PER_DAY)
    case "week":
      return new Date(anchor.getTime() + count * 7 * MS_PER_DAY)
    case "month":
      return addMonthsClamped(anchor, count)
    case "year":
      // Years are months×12 — reuses the clamp logic so Feb 29 + 1 year
      // → Feb 28 (non-leap), matching Stripe's leap-year behavior.
      return addMonthsClamped(anchor, count * 12)
    default: {
      // Exhaustiveness — TS narrows above.
      const exhaustive: never = interval
      throw new Error(`Unknown billing interval: ${exhaustive as string}`)
    }
  }
}

export function calculateNextPeriod(input: NextPeriodInput): NextPeriodResult {
  const { from, config } = input
  const start = new Date(from.getTime())
  const end = addInterval(start, config)
  return {
    currentPeriodStart: start,
    currentPeriodEnd: end,
    nextBillingAt: start,
  }
}

/**
 * Initial-period derivation for a brand-new subscription. Handles the
 * trial vs no-trial branching:
 *
 *   trialDays > 0  → period 1 is the trial (status='trial'), no charge
 *                    yet, nextBillingAt = trialEndsAt.
 *   trialDays = 0  → first paid period directly (status='active'),
 *                    nextBillingAt = now (Stripe-style charge at period start).
 *
 * Negative trialDays is treated as 0 (DB CHECK already rejects them at
 * write time, but the helper is defensive).
 */
const MS_PER_DAY_TRIAL = 24 * 60 * 60 * 1000

export function calculateInitialPeriod(
  input: InitialPeriodInput
): InitialPeriodResult {
  const { anchor, trialDays, config } = input
  const start = new Date(anchor.getTime())

  if (trialDays > 0) {
    const trialEndsAt = new Date(start.getTime() + trialDays * MS_PER_DAY_TRIAL)
    return {
      initialStatus: "trial",
      trialEndsAt,
      currentPeriodStart: start,
      currentPeriodEnd: trialEndsAt,
      nextBillingAt: trialEndsAt,
    }
  }

  // No trial — go straight into the paid period.
  const end = addInterval(start, config)
  return {
    initialStatus: "active",
    trialEndsAt: null,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    nextBillingAt: start,
  }
}
