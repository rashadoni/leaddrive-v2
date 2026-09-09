/**
 * Grant disbursement calculator — R8 slice 1.
 *
 * Given an approved grant amount + disbursement schedule, computes
 * the tranche plan: per-tranche date + amount such that the sum
 * equals the approved amount (within floating-point cent rounding).
 *
 * Schedules:
 *   lump_sum  — 1 tranche on startDate, full amount
 *   quarterly — 4 tranches, 1/4 each, 90 days apart starting startDate
 *   monthly   — 12 tranches, 1/12 each, 30 days apart starting startDate
 *   milestone — N tranches, caller supplies milestonePercentages[] that
 *               sum to 100, evenly spaced by 30 days (slice-2 may add
 *               milestone-by-deliverable date overrides)
 *
 * Rounding strategy:
 *   • Each tranche rounded to 2 decimal places (cent precision).
 *   • Last tranche absorbs any rounding remainder so sum == approvedAmount.
 *
 * Pure synchronous.
 */
import {
  DISBURSEMENT_SCHEDULES,
  type CalculateGrantDisbursementInput,
  type CalculateGrantDisbursementResult,
  type DisbursementSchedule,
  type DisbursementTranche,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

function isSchedule(v: unknown): v is DisbursementSchedule {
  return (
    typeof v === "string" &&
    (DISBURSEMENT_SCHEDULES as readonly string[]).includes(v)
  )
}

/** Round to 2 decimal places (cent precision). */
function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateGrantDisbursement(
  input: CalculateGrantDisbursementInput
): CalculateGrantDisbursementResult {
  if (!isFiniteNonNegative(input.approvedAmount)) {
    return {
      ok: false,
      error: "approvedAmount must be a finite non-negative number",
    }
  }
  if (!isSchedule(input.schedule)) {
    return { ok: false, error: `unknown schedule "${String(input.schedule)}"` }
  }
  if (!isFiniteDate(input.startDate)) {
    return { ok: false, error: "startDate must be a finite Date" }
  }

  const startMs = input.startDate.getTime()

  // Determine per-tranche dates + raw percentages.
  let trancheCount: number
  let dateOffsetDays: (i: number) => number
  let percentages: number[]

  switch (input.schedule) {
    case "lump_sum":
      trancheCount = 1
      dateOffsetDays = () => 0
      percentages = [100]
      break

    case "quarterly":
      trancheCount = 4
      // Tranche 1 on startDate, then every 90 days.
      dateOffsetDays = (i: number) => i * 90
      percentages = [25, 25, 25, 25]
      break

    case "monthly":
      trancheCount = 12
      dateOffsetDays = (i: number) => i * 30
      percentages = Array.from({ length: 12 }, () => 100 / 12)
      break

    case "milestone": {
      if (
        input.milestoneCount === undefined ||
        !Number.isInteger(input.milestoneCount) ||
        input.milestoneCount < 2 ||
        input.milestoneCount > 100
      ) {
        return {
          ok: false,
          error: "milestoneCount must be an integer 2..100 for milestone schedule",
        }
      }
      if (
        input.milestonePercentages === undefined ||
        !Array.isArray(input.milestonePercentages) ||
        input.milestonePercentages.length !== input.milestoneCount
      ) {
        return {
          ok: false,
          error: "milestonePercentages length must equal milestoneCount",
        }
      }
      let pctSum = 0
      for (const p of input.milestonePercentages) {
        if (!Number.isFinite(p) || p < 0) {
          return {
            ok: false,
            error: "every milestonePercentage must be a finite non-negative number",
          }
        }
        pctSum += p
      }
      if (Math.abs(pctSum - 100) > 0.01) {
        return {
          ok: false,
          error: `milestonePercentages sum is ${pctSum}, must equal 100`,
        }
      }
      trancheCount = input.milestoneCount
      // Evenly-spaced 30-day intervals; slice-2 may add date overrides.
      dateOffsetDays = (i: number) => i * 30
      percentages = [...input.milestonePercentages]
      break
    }

    default:
      // exhaustive — unreachable thanks to isSchedule check
      return {
        ok: false,
        error: `unhandled schedule "${String(input.schedule)}"`,
      }
  }

  // Build tranches with rounded amounts; track running total to
  // adjust the last tranche.
  const tranches: DisbursementTranche[] = []
  let runningTotal = 0
  for (let i = 0; i < trancheCount; i++) {
    const rawAmount = (input.approvedAmount * percentages[i]) / 100
    const isLast = i === trancheCount - 1
    let amount: number
    if (isLast) {
      // Last tranche absorbs rounding remainder for exact sum.
      amount = roundCents(input.approvedAmount - runningTotal)
    } else {
      amount = roundCents(rawAmount)
      runningTotal += amount
    }
    tranches.push({
      sequence: i + 1,
      scheduledDate: new Date(startMs + dateOffsetDays(i) * MS_PER_DAY),
      amount,
    })
  }

  // Verify sum == approvedAmount within cent tolerance.
  const totalScheduled = tranches.reduce((s, t) => s + t.amount, 0)
  if (Math.abs(totalScheduled - input.approvedAmount) > 0.005) {
    return {
      ok: false,
      error: `internal: tranche sum ${totalScheduled} differs from approvedAmount ${input.approvedAmount}`,
    }
  }

  return {
    ok: true,
    plan: { tranches, totalScheduled },
  }
}
