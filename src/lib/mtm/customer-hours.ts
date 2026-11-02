/**
 * «Часы приёма» of an MTM place (owner, 2026-11-02, mockup «MTM: часы приёма
 * клиентов», approved with «Давай, делай»): when a pharmacy or a clinic can be
 * visited — each weekday open–close, an optional lunch, a day it does not work.
 *
 * One level only: the hours live on the place. There is no company template
 * behind them (owner's rule: one setting, not two levels); filling many places
 * at once is a tool of the list, not a second setting.
 *
 * No hours is not «always open»: it is «не указаны», and nothing is constrained
 * by it — the planner keeps working as before and says so.
 *
 * Pure: no database, no clock.
 */
import { z } from "zod"

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const MTM_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type MtmWeekday = (typeof MTM_WEEKDAYS)[number]

export interface MtmDayHours {
  open: string
  close: string
  breakFrom?: string | null
  breakTo?: string | null
}

/** null for a weekday = the place does not work that day. */
export type MtmWorkingHours = Record<MtmWeekday, MtmDayHours | null>

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** «09:30» → 570; anything else → null. */
export function hoursMinutes(clock: string | null | undefined): number | null {
  if (!clock || !CLOCK.test(clock)) return null
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
}

const DaySchema = z.object({
  open: z.string().regex(CLOCK),
  close: z.string().regex(CLOCK),
  breakFrom: z.string().regex(CLOCK).nullable().optional(),
  breakTo: z.string().regex(CLOCK).nullable().optional(),
}).strict().superRefine((day, ctx) => {
  const open = hoursMinutes(day.open)!
  const close = hoursMinutes(day.close)!
  if (close <= open) ctx.addIssue({ code: "custom", message: "close must be after open", path: ["close"] })
  const hasFrom = day.breakFrom != null && day.breakFrom !== ""
  const hasTo = day.breakTo != null && day.breakTo !== ""
  if (hasFrom !== hasTo) {
    ctx.addIssue({ code: "custom", message: "lunch needs both ends", path: ["breakTo"] })
    return
  }
  if (hasFrom && hasTo) {
    const from = hoursMinutes(day.breakFrom)!
    const to = hoursMinutes(day.breakTo)!
    if (!(open < from && from < to && to < close)) {
      ctx.addIssue({ code: "custom", message: "lunch must lie inside the day", path: ["breakFrom"] })
    }
  }
})

/** What the API accepts: all seven days, each hours or null (does not work). */
export const MtmWorkingHoursSchema = z.object({
  1: DaySchema.nullable(),
  2: DaySchema.nullable(),
  3: DaySchema.nullable(),
  4: DaySchema.nullable(),
  5: DaySchema.nullable(),
  6: DaySchema.nullable(),
  7: DaySchema.nullable(),
}).strict().refine((week) => MTM_WEEKDAYS.some((day) => week[day] !== null), {
  message: "at least one working day",
})

function cleanDay(day: MtmDayHours): MtmDayHours {
  const hasBreak = Boolean(day.breakFrom && day.breakTo)
  return hasBreak
    ? { open: day.open, close: day.close, breakFrom: day.breakFrom!, breakTo: day.breakTo! }
    : { open: day.open, close: day.close }
}

/** Normalises what the schema accepted, for storage. */
export function normalizeWorkingHours(week: z.infer<typeof MtmWorkingHoursSchema>): MtmWorkingHours {
  const out = {} as MtmWorkingHours
  for (const day of MTM_WEEKDAYS) {
    const value = week[day]
    out[day] = value ? cleanDay(value) : null
  }
  return out
}

/**
 * Reads stored JSON back. Anything that is not a valid week is «не указаны»
 * (null), never a guess.
 */
export function readWorkingHours(value: unknown): MtmWorkingHours | null {
  if (value == null || typeof value !== "object") return null
  const parsed = MtmWorkingHoursSchema.safeParse(value)
  return parsed.success ? normalizeWorkingHours(parsed.data) : null
}

/** ISO weekday of a «YYYY-MM-DD» date key. */
export function weekdayOfDateKey(dateKey: string): MtmWeekday {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
  return (day === 0 ? 7 : day) as MtmWeekday
}

/**
 * The hours of one day: the day's hours, null when the place does not work,
 * undefined when nobody said.
 */
export function hoursOfDay(week: MtmWorkingHours | null, weekday: MtmWeekday): MtmDayHours | null | undefined {
  if (!week) return undefined
  return week[weekday]
}

export type MtmOpenState =
  | { kind: "unknown" }
  | { kind: "dayOff" }
  | { kind: "beforeOpen"; opensAt: string }
  | { kind: "open"; closesAt: string; breakFrom: string | null }
  | { kind: "lunch"; reopensAt: string }
  | { kind: "closed" }

/** Whether the place is open at a minute of the day — «Сейчас открыто · обед с 13:00». */
export function openStateAt(day: MtmDayHours | null | undefined, minute: number): MtmOpenState {
  if (day === undefined) return { kind: "unknown" }
  if (day === null) return { kind: "dayOff" }
  const open = hoursMinutes(day.open)!
  const close = hoursMinutes(day.close)!
  const from = hoursMinutes(day.breakFrom)
  const to = hoursMinutes(day.breakTo)
  if (minute < open) return { kind: "beforeOpen", opensAt: day.open }
  if (minute >= close) return { kind: "closed" }
  if (from != null && to != null && minute >= from && minute < to) return { kind: "lunch", reopensAt: day.breakTo! }
  return { kind: "open", closesAt: day.close, breakFrom: from != null && minute < from ? day.breakFrom! : null }
}

export type MtmArrivalVerdict =
  /** Nobody said when it works: nothing is constrained. */
  | { kind: "unknown"; start: number }
  | { kind: "ok"; start: number }
  /** Before opening or in the lunch: the visit starts later, at `start`. */
  | { kind: "wait"; start: number; waitMinutes: number; reason: "beforeOpen" | "lunch" }
  /** Closed by then, or does not work that day: the visit cannot happen. */
  | { kind: "closed"; reason: "dayOff" | "afterClose" }

/**
 * When a visit can start at a place if the agent can begin at `ready`
 * (minutes after midnight): at once, after waiting for the door, or never
 * that day.
 */
export function arrivalVerdict(day: MtmDayHours | null | undefined, ready: number): MtmArrivalVerdict {
  if (day === undefined) return { kind: "unknown", start: ready }
  if (day === null) return { kind: "closed", reason: "dayOff" }
  const open = hoursMinutes(day.open)!
  const close = hoursMinutes(day.close)!
  const from = hoursMinutes(day.breakFrom)
  const to = hoursMinutes(day.breakTo)
  let start = Math.max(ready, open)
  let reason: "beforeOpen" | "lunch" | null = ready < open ? "beforeOpen" : null
  if (from != null && to != null && start >= from && start < to) {
    start = to
    reason = "lunch"
  }
  if (start >= close) return { kind: "closed", reason: "afterClose" }
  if (reason) return { kind: "wait", start, waitMinutes: Math.round(start - ready), reason }
  return { kind: "ok", start }
}

/** Two weeks the same — «Понедельник → на все будни», copy from another place. */
export function sameWorkingHours(a: MtmWorkingHours | null, b: MtmWorkingHours | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
