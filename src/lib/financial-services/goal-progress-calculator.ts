/**
 * Goal progress calculator — R1 slice 1.
 *
 * Given a goal's target/current amounts + target date + "now",
 * computes progress %, remaining amount, months remaining, and the
 * required monthly contribution to hit target on time.
 *
 *   progressPct          = min(100, current/target × 100)
 *   remainingMinor       = max(0, target - current)
 *   monthsRemaining      = floor(daysUntilTarget / 30.44)
 *   requiredMonthlyMinor = ceil(remainingMinor / monthsRemaining)
 *
 * Pure synchronous. Money math in integer minor units.
 *
 * Notes:
 *   • progressPct CAN reach 100 even if current > target (capped).
 *     The `isAchieved` flag distinguishes (current >= target).
 *   • If target date is past AND not achieved, `isOverdue = true`.
 *     `requiredMonthlyMinor` is null in this case (no months left).
 *   • If no target date set, `monthsRemaining` + `requiredMonthlyMinor`
 *     are both null. UI shows "no deadline".
 */
import type {
  CalculateGoalProgressInput,
  CalculateGoalProgressResult,
  GoalProgressResult,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DAYS_PER_MONTH_AVG = 30.44 // 365.25 / 12

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isNonNegInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
}

export function calculateGoalProgress(
  input: CalculateGoalProgressInput
): CalculateGoalProgressResult {
  if (!isNonNegInteger(input.targetAmountMinor)) {
    return { ok: false, error: "targetAmountMinor must be a non-negative integer" }
  }
  if (input.targetAmountMinor === 0) {
    return { ok: false, error: "targetAmountMinor must be > 0 (a $0 target makes no sense)" }
  }
  if (!isNonNegInteger(input.currentAmountMinor)) {
    return { ok: false, error: "currentAmountMinor must be a non-negative integer" }
  }
  if (!isFiniteDate(input.asOf)) {
    return { ok: false, error: "asOf must be a valid Date" }
  }
  if (input.targetDate !== null && !isFiniteDate(input.targetDate)) {
    return { ok: false, error: "targetDate must be a valid Date or null" }
  }

  const isAchieved = input.currentAmountMinor >= input.targetAmountMinor
  const remainingMinor = Math.max(0, input.targetAmountMinor - input.currentAmountMinor)

  // Progress percentage — capped at 100. Use integer math to avoid
  // Float drift on round numbers (50/100 = 50.0000001 etc.).
  // 100 * current / target — for typical values, well within
  // MAX_SAFE_INTEGER; cap at 100 for over-funded goals.
  const progressPctRaw = (100 * input.currentAmountMinor) / input.targetAmountMinor
  const progressPct = Math.min(100, progressPctRaw)

  let monthsRemaining: number | null = null
  let requiredMonthlyMinor: number | null = null
  let isOverdue = false

  if (input.targetDate !== null) {
    const targetMs = input.targetDate.getTime()
    const asOfMs = input.asOf.getTime()
    if (asOfMs >= targetMs) {
      // Target date in the past.
      monthsRemaining = 0
      if (!isAchieved) {
        isOverdue = true
      }
    } else {
      const daysRemaining = (targetMs - asOfMs) / MS_PER_DAY
      monthsRemaining = Math.floor(daysRemaining / DAYS_PER_MONTH_AVG)
      // If less than one month remaining and remaining amount > 0,
      // requiredMonthly is the full remaining (1-shot lump sum).
      if (!isAchieved) {
        const months = monthsRemaining > 0 ? monthsRemaining : 1
        requiredMonthlyMinor = Math.ceil(remainingMinor / months)
      }
    }
  }

  const progress: GoalProgressResult = {
    progressPct,
    remainingMinor,
    monthsRemaining,
    requiredMonthlyMinor,
    isAchieved,
    isOverdue,
  }
  return { ok: true, progress }
}
