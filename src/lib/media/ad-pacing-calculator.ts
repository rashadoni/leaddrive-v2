/**
 * Ad pacing calculator — R11 slice 1.
 *
 * Given a campaign's budget + flight + current spend + "now",
 * computes whether the campaign is pacing correctly and what the
 * daily-pace target should be.
 *
 * Calculations:
 *   totalDuration = flightEnd − flightStart (in ms)
 *   elapsedDuration = clamp(asOf − flightStart, 0, totalDuration)
 *   linearProgress = elapsedDuration / totalDuration  (0..1)
 *   expectedSpendByNow = totalBudget × linearProgress
 *
 *   remainingBudget = totalBudget − spentAmount
 *   remainingDays = max(0, ceil((flightEnd − asOf) / 1 day))
 *   dailyPaceTarget = remainingDays > 0
 *                       ? remainingBudget / remainingDays
 *                       : remainingBudget
 *   (clamped to dailyBudgetCap if set)
 *
 *   isOverPaced = spent > expected × 1.10  (10% ahead)
 *   isUnderPaced = spent < expected × 0.90 (10% behind)
 *
 * Pure synchronous.
 */
import type {
  CalculatePacingInput,
  CalculatePacingResult,
  PacingPlan,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Pacing threshold multipliers. Slice-2 config-table wiring will
 * replace these with per-tenant configurable values; slice-1 ships
 * the industry-standard 10% defaults.
 *   spent > expected × OVER  → flag isOverPaced
 *   spent < expected × UNDER → flag isUnderPaced
 */
export const OVER_PACE_THRESHOLD = 1.1
export const UNDER_PACE_THRESHOLD = 0.9

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

export function calculateAdPacing(
  input: CalculatePacingInput
): CalculatePacingResult {
  if (!isFiniteNonNegative(input.totalBudget)) {
    return {
      ok: false,
      error: "totalBudget must be a finite non-negative number",
    }
  }
  if (!isFiniteNonNegative(input.spentAmount)) {
    return {
      ok: false,
      error: "spentAmount must be a finite non-negative number",
    }
  }
  if (input.spentAmount > input.totalBudget) {
    return {
      ok: false,
      error: `spentAmount ${input.spentAmount} exceeds totalBudget ${input.totalBudget}`,
    }
  }
  if (!isFiniteDate(input.flightStartAt)) {
    return { ok: false, error: "flightStartAt must be a finite Date" }
  }
  if (!isFiniteDate(input.flightEndAt)) {
    return { ok: false, error: "flightEndAt must be a finite Date" }
  }
  if (input.flightEndAt.getTime() <= input.flightStartAt.getTime()) {
    return {
      ok: false,
      error: "flightEndAt must be strictly after flightStartAt",
    }
  }
  if (!isFiniteDate(input.asOf)) {
    return { ok: false, error: "asOf must be a finite Date" }
  }
  if (
    input.dailyBudgetCap !== null &&
    input.dailyBudgetCap !== undefined &&
    !isFiniteNonNegative(input.dailyBudgetCap)
  ) {
    return {
      ok: false,
      error: "dailyBudgetCap must be a finite non-negative number when supplied",
    }
  }

  const startMs = input.flightStartAt.getTime()
  const endMs = input.flightEndAt.getTime()
  const asOfMs = input.asOf.getTime()
  const totalDuration = endMs - startMs
  const elapsed = Math.max(0, Math.min(asOfMs - startMs, totalDuration))
  const linearProgress = elapsed / totalDuration
  const expectedSpendByNow = input.totalBudget * linearProgress
  const remainingBudget = input.totalBudget - input.spentAmount

  // Remaining days: ceil so partial days count as full.
  const remainingMs = Math.max(0, endMs - asOfMs)
  const remainingDays = Math.ceil(remainingMs / MS_PER_DAY)

  let dailyPaceTarget =
    remainingDays > 0 ? remainingBudget / remainingDays : remainingBudget
  if (
    input.dailyBudgetCap !== null &&
    input.dailyBudgetCap !== undefined &&
    dailyPaceTarget > input.dailyBudgetCap
  ) {
    dailyPaceTarget = input.dailyBudgetCap
  }

  // Pacing flags: ±10% threshold (slice-1 default; see top-level constants).
  const overThreshold = expectedSpendByNow * OVER_PACE_THRESHOLD
  const underThreshold = expectedSpendByNow * UNDER_PACE_THRESHOLD
  const isOverPaced =
    expectedSpendByNow > 0 && input.spentAmount > overThreshold
  const isUnderPaced =
    expectedSpendByNow > 0 && input.spentAmount < underThreshold

  const pacing: PacingPlan = {
    remainingBudget,
    remainingDays,
    dailyPaceTarget,
    isOverPaced,
    isUnderPaced,
    expectedSpendByNow,
  }
  return { ok: true, pacing }
}
