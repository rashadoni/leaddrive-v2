/**
 * Recognition calculator — M4 Phase 6 Block C slice 1.
 *
 * Given a single schedule line + asOf + how-much-already-posted,
 * computes how much SHOULD be recognized now and what the schedule
 * line's status should become.
 *
 * Semantics per method:
 *   point_in_time           — all-or-nothing at periodEnd. Before
 *                             periodEnd: postNow = 0. At/after:
 *                             postNow = scheduled - postedToDate.
 *   over_time_straight_line — pro-rata based on (asOf - start) /
 *                             (end - start) clamped to [0, 1].
 *                             Slice-2 cron may "catch up" if it
 *                             missed a previous month.
 *   milestone               — same all-or-nothing semantic as
 *                             point_in_time but tied to the
 *                             milestone's dueAt (which equals
 *                             periodStart == periodEnd in the
 *                             schedule line shape).
 *   usage_based             — slice-1 emits 0 (slice-2 wires the
 *                             usage-event consumption helper). We
 *                             surface that explicitly so callers
 *                             don't accidentally use this calc.
 *
 * All math in integer minor units. Pro-rata is computed as
 * `floor(scheduled * elapsed_ms / total_ms)` — never overruns.
 *
 * Pure synchronous.
 */
import type {
  CalculateRecognitionInput,
  CalculateRecognitionResult,
  RecognitionCalculation,
  ScheduleStatus,
} from "./types"
import { RECOGNITION_METHODS } from "./types"

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0
}

/**
 * Derive ScheduleStatus from cumulative-vs-scheduled state. Helper
 * does NOT decide between transition-legal vs not; caller may
 * intersect this with `canScheduleTransition`.
 */
function deriveStatus(
  cumulativeMinor: number,
  scheduledMinor: number
): ScheduleStatus | null {
  if (cumulativeMinor === 0) return "scheduled"
  if (cumulativeMinor < scheduledMinor) return "partially_recognized"
  if (cumulativeMinor === scheduledMinor) return "recognized"
  // Over-posted state — slice-2 reversal territory; helper surfaces null.
  return null
}

export function calculateRecognition(
  input: CalculateRecognitionInput
): CalculateRecognitionResult {
  if (!isNonNegInt(input.scheduledMinor)) {
    return { ok: false, error: "scheduledMinor must be a non-negative integer" }
  }
  if (!isNonNegInt(input.postedToDateMinor)) {
    return { ok: false, error: "postedToDateMinor must be a non-negative integer" }
  }
  if (input.postedToDateMinor > input.scheduledMinor) {
    return {
      ok: false,
      error: `postedToDate ${input.postedToDateMinor} exceeds scheduled ${input.scheduledMinor} — slice-2 reversal territory`,
    }
  }
  if (!isFiniteDate(input.periodStart) || !isFiniteDate(input.periodEnd)) {
    return { ok: false, error: "periodStart and periodEnd must be valid Dates" }
  }
  if (input.periodEnd.getTime() < input.periodStart.getTime()) {
    return { ok: false, error: "periodEnd must be >= periodStart" }
  }
  if (!isFiniteDate(input.asOf)) {
    return { ok: false, error: "asOf must be a valid Date" }
  }
  if (!(RECOGNITION_METHODS as readonly string[]).includes(input.method)) {
    return { ok: false, error: `unknown method "${String(input.method)}"` }
  }

  const startMs = input.periodStart.getTime()
  const endMs = input.periodEnd.getTime()
  const asOfMs = input.asOf.getTime()

  // Compute cumulativeTarget — how much SHOULD be cumulatively
  // recognized by asOf for this line, per the method.
  let cumulativeTargetMinor = 0

  switch (input.method) {
    case "point_in_time":
    case "milestone": {
      // All-or-nothing at periodEnd.
      // Boundary semantics:
      //   • asOf < periodEnd        → cumulativeTarget = 0
      //   • asOf >= periodEnd       → cumulativeTarget = scheduledMinor
      // periodStart is irrelevant for these methods — only periodEnd
      // gates recognition.
      cumulativeTargetMinor = asOfMs >= endMs ? input.scheduledMinor : 0
      break
    }
    case "over_time_straight_line": {
      // Boundary semantics:
      //   • asOf <= periodStart     → cumulativeTarget = 0 (period hasn't opened)
      //   • asOf >= periodEnd       → cumulativeTarget = scheduledMinor (fully amortised)
      //   • periodStart < asOf < periodEnd → pro-rata via floor(scheduled * elapsed / total)
      // Both endpoints are inclusive: at asOf == periodStart we recognize
      // 0 (period just opened); at asOf == periodEnd we recognize the full
      // scheduled amount. The "<=" / ">=" comparisons here pin this.
      if (asOfMs <= startMs) {
        cumulativeTargetMinor = 0
      } else if (asOfMs >= endMs) {
        cumulativeTargetMinor = input.scheduledMinor
      } else {
        const total = endMs - startMs
        const elapsed = asOfMs - startMs
        // Edge: total == 0 (zero-duration line) — earliest branch already
        // handled asOf >= endMs. If somehow startMs == endMs, divide-by-
        // zero protected here.
        if (total === 0) {
          cumulativeTargetMinor = input.scheduledMinor
        } else {
          // BigInt multiplication BEFORE divide, then floor via integer
          // division. Defends against Number.MAX_SAFE_INTEGER overflow
          // for large enterprise contracts (e.g. $10M × 10-year period
          // = scheduledMinor 1e9 × elapsed_ms 3.15e11 = 3.15e20 — well
          // above 2^53). architect-pass-1 closed this.
          const numerator = BigInt(input.scheduledMinor) * BigInt(elapsed)
          const result = numerator / BigInt(total) // BigInt integer division floors toward 0 for positive
          // BigInt → Number conversion: safe here because result is
          // bounded by scheduledMinor (which is a regular Number).
          cumulativeTargetMinor = Number(result)
        }
      }
      break
    }
    case "usage_based": {
      // Slice-1 doesn't compute usage targets. Slice-2 wires a separate
      // helper that consumes usage events. Surface this explicitly.
      const calc: RecognitionCalculation = {
        postNowMinor: 0,
        cumulativeMinor: input.postedToDateMinor,
        suggestedStatus: deriveStatus(input.postedToDateMinor, input.scheduledMinor),
      }
      return { ok: true, calc }
    }
  }

  // postNow = max(0, cumulativeTarget - postedToDate).
  // Helper never returns negative (reversals are slice-2 caller side).
  const postNowMinor = Math.max(0, cumulativeTargetMinor - input.postedToDateMinor)
  const cumulativeMinor = input.postedToDateMinor + postNowMinor

  const calc: RecognitionCalculation = {
    postNowMinor,
    cumulativeMinor,
    suggestedStatus: deriveStatus(cumulativeMinor, input.scheduledMinor),
  }

  return { ok: true, calc }
}
