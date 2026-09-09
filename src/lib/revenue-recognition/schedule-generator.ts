/**
 * Schedule generator — M4 Phase 6 Block C slice 1.
 *
 * Given a PO + recognition method, produce schedule lines. Slice-2
 * cron iterates the lines to post recognition entries.
 *
 *   point_in_time           — 1 line at periodEnd, full amount
 *   over_time_straight_line — N month-aligned lines, equal slices
 *                             (rounding remainder distributed to
 *                             earliest months)
 *   milestone               — caller-supplied milestones[]; weight
 *                             share of allocatedMinor each
 *   usage_based             — slice 1 emits a SINGLE bookkeeping
 *                             line covering the full period; slice-2
 *                             usage events consume this incrementally
 *
 * All money math in integer minor units. Date arithmetic uses
 * calendar months (Year+Month start). Generator does NOT respect
 * tenant timezones — caller is expected to pass UTC dates.
 *
 * Pure synchronous.
 */
import type {
  GenerateScheduleInput,
  GenerateScheduleResult,
  GeneratedScheduleLine,
} from "./types"
import { RECOGNITION_METHODS } from "./types"

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

/* ─── Month enumeration ───────────────────────────────────────────────── */

/**
 * Inclusive list of (year, month-0-indexed) periods spanned by
 * `[start, end]`. End-inclusive on the calendar-month sense — i.e.
 * a period of 2026-01-15 → 2026-03-10 yields Jan/Feb/Mar.
 */
function enumerateMonths(start: Date, end: Date): { year: number; month: number }[] {
  const result: { year: number; month: number }[] = []
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth()
  const yEnd = end.getUTCFullYear()
  const mEnd = end.getUTCMonth()
  while (y < yEnd || (y === yEnd && m <= mEnd)) {
    result.push({ year: y, month: m })
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
  }
  return result
}

function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
}

function monthEnd(year: number, month: number): Date {
  // First day of next month minus 1 millisecond — UTC.
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - 1)
}

/* ─── Main entry ──────────────────────────────────────────────────────── */

export function generateSchedule(
  input: GenerateScheduleInput
): GenerateScheduleResult {
  // 1. Validate.
  if (!(RECOGNITION_METHODS as readonly string[]).includes(input.method)) {
    return { ok: false, error: `unknown method "${String(input.method)}"` }
  }
  if (
    typeof input.allocatedMinor !== "number" ||
    !Number.isInteger(input.allocatedMinor) ||
    input.allocatedMinor < 0
  ) {
    return { ok: false, error: "allocatedMinor must be a non-negative integer" }
  }
  if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) {
    return { ok: false, error: "currency must be a 3-letter ISO-4217 code" }
  }
  if (typeof input.performanceObligationId !== "string" || input.performanceObligationId.length === 0) {
    return { ok: false, error: "performanceObligationId must be a non-empty string" }
  }
  if (!isFiniteDate(input.periodStart) || !isFiniteDate(input.periodEnd)) {
    return { ok: false, error: "periodStart and periodEnd must be valid Dates" }
  }
  if (input.periodEnd.getTime() < input.periodStart.getTime()) {
    return { ok: false, error: "periodEnd must be >= periodStart" }
  }

  const { performanceObligationId, allocatedMinor, currency } = input

  // 2. Dispatch by method.
  switch (input.method) {
    case "point_in_time": {
      const line: GeneratedScheduleLine = {
        performanceObligationId,
        lineNumber: 1,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        scheduledMinor: allocatedMinor,
        currency,
        label: "point-in-time",
      }
      return { ok: true, lines: [line] }
    }

    case "over_time_straight_line": {
      const months = enumerateMonths(input.periodStart, input.periodEnd)
      if (months.length === 0) {
        return { ok: false, error: "over_time_straight_line: derived 0 months in period" }
      }
      const base = Math.floor(allocatedMinor / months.length)
      let remainder = allocatedMinor - base * months.length
      const lines: GeneratedScheduleLine[] = months.map((m, idx) => {
        const extra = remainder > 0 ? 1 : 0
        remainder -= extra
        const start = monthStart(m.year, m.month)
        const end = monthEnd(m.year, m.month)
        // Clamp first month start to periodStart and last month end to periodEnd
        // so the schedule's outer bounds match the PO's exact dates (downstream
        // pro-rata math may use this).
        const lineStart =
          idx === 0 && start.getTime() < input.periodStart.getTime()
            ? input.periodStart
            : start
        const lineEnd =
          idx === months.length - 1 && end.getTime() > input.periodEnd.getTime()
            ? input.periodEnd
            : end
        return {
          performanceObligationId,
          lineNumber: idx + 1,
          periodStart: lineStart,
          periodEnd: lineEnd,
          scheduledMinor: base + extra,
          currency,
          label: `month-${idx + 1}`,
        }
      })
      return { ok: true, lines }
    }

    case "milestone": {
      const milestones = input.milestones
      if (!milestones || milestones.length === 0) {
        return {
          ok: false,
          error: "milestone method requires non-empty milestones[]",
        }
      }
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i]
        if (typeof m.label !== "string" || m.label.length === 0) {
          return { ok: false, error: `milestones[${i}].label must be non-empty` }
        }
        if (!isFiniteDate(m.dueAt)) {
          return { ok: false, error: `milestones[${i}].dueAt must be a valid Date` }
        }
        // Weights MUST be positive integers — keeps the helper's
        // "no Float arithmetic" discipline consistent with the rest
        // of the module (architect-pass-1 close-out). Fractional
        // weights (1.5, 2.7) introduced Float drift via the
        // proportional-share math.
        if (
          typeof m.weight !== "number" ||
          !Number.isInteger(m.weight) ||
          m.weight <= 0
        ) {
          return {
            ok: false,
            error: `milestones[${i}].weight must be a positive integer`,
          }
        }
        if (
          m.dueAt.getTime() < input.periodStart.getTime() ||
          m.dueAt.getTime() > input.periodEnd.getTime()
        ) {
          return {
            ok: false,
            error: `milestones[${i}].dueAt must fall within [periodStart, periodEnd]`,
          }
        }
      }
      const weightSum = milestones.reduce((acc, m) => acc + m.weight, 0)
      if (weightSum <= 0) {
        return { ok: false, error: "milestone weights sum must be > 0" }
      }
      // Pass 1: floor allocation via BigInt to defend against overflow
      // (allocatedMinor × weight can exceed 2^53 for large enterprise
      // contracts). Pass 2: distribute remainder earliest-first.
      const lines: GeneratedScheduleLine[] = []
      let sum = 0
      const allocatedBig = BigInt(allocatedMinor)
      const weightSumBig = BigInt(weightSum)
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i]
        const exactBig = (allocatedBig * BigInt(m.weight)) / weightSumBig // BigInt floor div
        const floored = Number(exactBig)
        sum += floored
        lines.push({
          performanceObligationId,
          lineNumber: i + 1,
          periodStart: m.dueAt,
          periodEnd: m.dueAt,
          scheduledMinor: floored,
          currency,
          label: m.label,
        })
      }
      let remainder = allocatedMinor - sum
      for (let i = 0; i < lines.length && remainder > 0; i++) {
        lines[i].scheduledMinor += 1
        remainder -= 1
      }
      return { ok: true, lines }
    }

    case "usage_based": {
      // Slice-1 emits a single bookkeeping line covering the full period.
      // Slice-2 usage events will partial-recognize against it. The
      // schedule status starts as 'scheduled'; partial entries flip it
      // to 'partially_recognized' until exhausted.
      const line: GeneratedScheduleLine = {
        performanceObligationId,
        lineNumber: 1,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        scheduledMinor: allocatedMinor,
        currency,
        label: "usage-based-bucket",
      }
      return { ok: true, lines: [line] }
    }
  }
}
