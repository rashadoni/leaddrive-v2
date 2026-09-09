/**
 * Schedule evaluator — G5 slice 1.
 *
 * Minimal cron parser + "is-due" check for slice-2 activation cron
 * worker. Supports the standard 5-field cron syntax with these
 * features:
 *   *           — any value
 *   N           — exact value
 *   N,N,N       — list
 *   N-N         — range
 *   STEP        — "asterisk-slash-N" step from 0; X-Y/N step within range
 *
 * Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0=Sunday)
 *
 * Algorithm:
 *   1. Parse all 5 fields to bitmask sets.
 *   2. Walk minute-by-minute forward from `lastRunAt` (or asOf if null)
 *      up to 366 days, return the first matching wall-clock minute.
 *   3. isDue := nextFireAt <= asOf
 *
 * Pure synchronous. Slice-2 may swap to a battle-tested cron library
 * (node-cron / croner) if advanced syntax (L, W, #, day-name aliases,
 * range with step like `9-17/2`) becomes a requirement.
 */
import type {
  EvaluateScheduleInput,
  EvaluateScheduleResult,
  ScheduleEvaluation,
} from "./types"

interface ParsedField {
  /** Set of valid integer values in the field's range. */
  values: Set<number>
}

interface ParsedSchedule {
  minute: ParsedField
  hour: ParsedField
  dayOfMonth: ParsedField
  month: ParsedField
  dayOfWeek: ParsedField
}

function parseField(
  raw: string,
  min: number,
  max: number,
  fieldName: string
): ParsedField | { error: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { error: `${fieldName}: empty field` }
  }
  const values = new Set<number>()
  // Split list-of-parts on comma.
  const parts = trimmed.split(",")
  for (const part of parts) {
    // Step suffix: "X/N" or "*/N" — N must be >= 1.
    let stepBase = part
    let step = 1
    const slashIdx = part.indexOf("/")
    if (slashIdx !== -1) {
      stepBase = part.slice(0, slashIdx)
      const stepStr = part.slice(slashIdx + 1)
      const s = parseInt(stepStr, 10)
      if (!Number.isInteger(s) || s < 1) {
        return { error: `${fieldName}: step "${stepStr}" must be a positive integer` }
      }
      step = s
    }
    // Range "X-Y" / single "X" / wildcard "*".
    let rangeStart: number
    let rangeEnd: number
    if (stepBase === "*") {
      rangeStart = min
      rangeEnd = max
    } else if (stepBase.includes("-")) {
      const dashIdx = stepBase.indexOf("-")
      const startStr = stepBase.slice(0, dashIdx)
      const endStr = stepBase.slice(dashIdx + 1)
      const a = parseInt(startStr, 10)
      const b = parseInt(endStr, 10)
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        return { error: `${fieldName}: invalid range "${stepBase}"` }
      }
      if (a < min || b > max || a > b) {
        return { error: `${fieldName}: range "${stepBase}" out of bounds [${min}, ${max}]` }
      }
      rangeStart = a
      rangeEnd = b
    } else {
      const n = parseInt(stepBase, 10)
      if (!Number.isInteger(n)) {
        return { error: `${fieldName}: invalid value "${stepBase}"` }
      }
      if (n < min || n > max) {
        return { error: `${fieldName}: value ${n} out of bounds [${min}, ${max}]` }
      }
      rangeStart = n
      rangeEnd = n
    }
    for (let v = rangeStart; v <= rangeEnd; v += step) {
      values.add(v)
    }
  }
  if (values.size === 0) {
    return { error: `${fieldName}: produced empty value set` }
  }
  return { values }
}

function parseSchedule(schedule: string): ParsedSchedule | { error: string } {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) {
    return {
      error: `cron must have exactly 5 space-separated fields; got ${fields.length}`,
    }
  }
  const minute = parseField(fields[0], 0, 59, "minute")
  if ("error" in minute) return { error: minute.error }
  const hour = parseField(fields[1], 0, 23, "hour")
  if ("error" in hour) return { error: hour.error }
  const dayOfMonth = parseField(fields[2], 1, 31, "dayOfMonth")
  if ("error" in dayOfMonth) return { error: dayOfMonth.error }
  const month = parseField(fields[3], 1, 12, "month")
  if ("error" in month) return { error: month.error }
  const dayOfWeek = parseField(fields[4], 0, 6, "dayOfWeek")
  if ("error" in dayOfWeek) return { error: dayOfWeek.error }
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

const MS_PER_MINUTE = 60 * 1000
const MAX_LOOKAHEAD_MINUTES = 366 * 24 * 60 // 1 year + leap-day

/**
 * Walk minute-by-minute forward from `searchStart` looking for the
 * first wall-clock minute matching all 5 fields. Uses caller's UTC
 * "wall-clock" — slice-2 worker may apply timezone offset before
 * passing dates.
 */
function findNextFire(
  parsed: ParsedSchedule,
  searchStart: Date
): Date | null {
  // Round up to the next minute boundary — cron doesn't fire mid-minute.
  const startMs = Math.ceil(searchStart.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE
  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i++) {
    const ms = startMs + i * MS_PER_MINUTE
    const d = new Date(ms)
    const minute = d.getUTCMinutes()
    const hour = d.getUTCHours()
    const dayOfMonth = d.getUTCDate()
    const month = d.getUTCMonth() + 1 // JS uses 0-11; cron 1-12
    const dayOfWeek = d.getUTCDay() // 0=Sunday, same as cron
    if (
      parsed.minute.values.has(minute) &&
      parsed.hour.values.has(hour) &&
      parsed.dayOfMonth.values.has(dayOfMonth) &&
      parsed.month.values.has(month) &&
      parsed.dayOfWeek.values.has(dayOfWeek)
    ) {
      return d
    }
  }
  return null
}

export function evaluateSchedule(
  input: EvaluateScheduleInput
): EvaluateScheduleResult {
  if (!isFiniteDate(input.asOf)) {
    return { ok: false, error: "asOf must be a valid Date" }
  }
  if (input.lastRunAt !== null && !isFiniteDate(input.lastRunAt)) {
    return { ok: false, error: "lastRunAt must be a valid Date or null" }
  }

  if (input.schedule === null) {
    // Manual-only — never due via schedule.
    const evaluation: ScheduleEvaluation = {
      isDue: false,
      nextFireAt: null,
      parseValid: true,
    }
    return { ok: true, evaluation }
  }
  if (typeof input.schedule !== "string") {
    return { ok: false, error: "schedule must be a string or null" }
  }

  const parsed = parseSchedule(input.schedule)
  if ("error" in parsed) {
    const evaluation: ScheduleEvaluation = {
      isDue: false,
      nextFireAt: null,
      parseValid: false,
      parseError: parsed.error,
    }
    return { ok: true, evaluation }
  }

  // Search start: max(lastRunAt + 1 minute, asOf - 24h).
  //
  // For "is due" check, we want the FIRST fire time at-or-after the
  // minute lastRunAt was in (so if lastRun was at 03:00 and cron is
  // hourly, next fire = 04:00). If lastRunAt is null, search from
  // asOf - 24h so we don't miss a recent-pending fire.
  //
  // Architect-pass-1 close-out: clamp to asOf - 24h floor when
  // lastRunAt is "ancient" (e.g. a misconfigured 1999 timestamp).
  // Without the clamp, MAX_LOOKAHEAD_MINUTES (366 days) is consumed
  // walking from the ancient timestamp and we'd return nextFireAt=null
  // for any schedule whose first match after lastRunAt falls beyond
  // that window — silently rendering the activation never-fire.
  const lookbackFloor = input.asOf.getTime() - 24 * 60 * MS_PER_MINUTE
  const searchStart = new Date(
    input.lastRunAt !== null
      ? Math.max(input.lastRunAt.getTime() + MS_PER_MINUTE, lookbackFloor)
      : lookbackFloor
  )

  const nextFireAt = findNextFire(parsed, searchStart)
  if (nextFireAt === null) {
    const evaluation: ScheduleEvaluation = {
      isDue: false,
      nextFireAt: null,
      parseValid: true,
    }
    return { ok: true, evaluation }
  }

  // Is due: nextFire happened at-or-before asOf.
  const isDue = nextFireAt.getTime() <= input.asOf.getTime()
  // If due, the NEXT firing is the one AFTER the due one — for caller's
  // "schedule the next run" display. Compute it for them.
  let displayNextFire = nextFireAt
  if (isDue) {
    const after = findNextFire(parsed, new Date(nextFireAt.getTime() + MS_PER_MINUTE))
    if (after !== null) displayNextFire = after
  }

  const evaluation: ScheduleEvaluation = {
    isDue,
    nextFireAt: displayNextFire,
    parseValid: true,
  }
  return { ok: true, evaluation }
}
