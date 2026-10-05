import { z } from "zod"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"

export const SLA_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const interval = z.object({ start: time, end: time }).strict().refine(value => value.start < value.end)
const intervals = z.array(interval).max(8).refine(values => {
  const ordered = [...values].sort((a, b) => a.start.localeCompare(b.start))
  return ordered.every((value, index) => index === 0 || value.start >= ordered[index - 1].end)
}, "Intervals must not overlap")
const day = z.object({ enabled: z.boolean(), intervals }).strict()
const schedule = z.object({
  mon: day.optional(), tue: day.optional(), wed: day.optional(), thu: day.optional(),
  fri: day.optional(), sat: day.optional(), sun: day.optional(),
}).strict().refine(value => Object.values(value).some(d => d.enabled && d.intervals.length > 0), "Calendar needs working time")
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T00:00:00Z")
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})
const holidays = z.array(z.object({
  date, name: z.string().max(120).optional(), closed: z.boolean().optional(), intervals: intervals.optional(),
}).strict()).max(120).refine(values => new Set(values.map(value => value.date)).size === values.length)

export const slaBusinessCalendarSchema = z.object({
  version: z.literal(1),
  sourceId: z.string().min(1).max(128),
  capturedAt: z.string().datetime(),
  sourceUpdatedAt: z.string().datetime(),
  timezone: z.string().min(1).max(100).refine(isValidTimezone),
  boundaryPolicy: z.literal("reject_ambiguous_or_missing"),
  schedule,
  holidays,
}).strict()

export type SlaBusinessCalendar = z.infer<typeof slaBusinessCalendarSchema>
export class SlaCalendarError extends Error {
  constructor(readonly code: "SLA_CALENDAR_INVALID" | "SLA_CALENDAR_LIMIT" | "SLA_CALENDAR_BOUNDARY_INVALID" | "SLA_CALENDAR_SOURCE_CHANGED") {
    super(code)
  }
}
export function readSlaBusinessCalendar(value: unknown): SlaBusinessCalendar {
  const parsed = slaBusinessCalendarSchema.safeParse(value)
  if (!parsed.success) throw new SlaCalendarError("SLA_CALENDAR_INVALID")
  return parsed.data
}

/**
 * Prospective deadline from an immutable policy snapshot.
 * Count real elapsed milliseconds inside local half-open work intervals, with holiday overrides.
 * Waiting is not a pause in the existing ticket contract. Explicit completed pause intervals can
 * be excluded by callers that own such a lifecycle; this helper never rewrites stored deadlines.
 * Ambiguous/nonexistent interval boundaries fail closed; never silently choose another local time.
 */
export function addSlaWorkingMilliseconds(
  anchor: Date,
  milliseconds: number,
  calendar: SlaBusinessCalendar,
  pauses: readonly { from: Date; to: Date }[] = [],
): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(milliseconds) || milliseconds < 0) throw new SlaCalendarError("SLA_CALENDAR_INVALID")
  const excluded = pauses.map(pause => [pause.from.getTime(), pause.to.getTime()] as const).sort((a, b) => a[0] - b[0])
  if (excluded.some(([from, to], index) => !Number.isFinite(from) || !Number.isFinite(to) || to < from || (index > 0 && from < excluded[index - 1][1]))) throw new SlaCalendarError("SLA_CALENDAR_INVALID")
  if (milliseconds === 0) return new Date(anchor)
  let remaining = Math.round(milliseconds)
  // Same reject-gap/fold contract as localDateTimeToUnambiguousUtc. Reuse a formatter and
  // daily candidate offsets so a long SLA does not construct thousands of Intl formatters.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: calendar.timezone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  })
  const wallMinute = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  }
  const offsetsByDay = new Map<string, Set<number>>()
  const boundary = (dateKey: string, clock: string) => {
    const naive = Date.parse(dateKey + "T" + clock + ":00Z")
    let offsets = offsetsByDay.get(dateKey)
    if (!offsets) {
      offsets = new Set<number>()
      const noon = Date.parse(dateKey + "T12:00:00Z")
      for (let hours = -48; hours <= 48; hours += 6) {
        const sample = noon + hours * 3600000
        offsets.add(wallMinute(sample) - sample)
      }
      offsetsByDay.set(dateKey, offsets)
    }
    const candidates = [...offsets].map(offset => naive - offset).filter(instant => wallMinute(instant) === naive)
    if (candidates.length !== 1) throw new SlaCalendarError("SLA_CALENDAR_BOUNDARY_INVALID")
    return candidates[0]
  }
  const first = dateInputValueInTimezone(anchor, calendar.timezone)
  const dayCursor = new Date(first + "T00:00:00Z")
  // Bounded at ten calendar years, including calendars with very little weekly capacity.
  for (let days = 0; days < 3660; days += 1) {
    const dateKey = dayCursor.toISOString().slice(0, 10)
    const holiday = calendar.holidays.find(value => value.date === dateKey)
    const regular = calendar.schedule[SLA_WEEKDAYS[dayCursor.getUTCDay()]]
    const windows = holiday?.intervals?.length ? holiday.intervals
      : holiday && holiday.closed !== false ? []
      : regular?.enabled ? regular.intervals : []
    for (const window of [...windows].sort((a, b) => a.start.localeCompare(b.start))) {
      let from: number, to: number
      try {
        from = Math.max(anchor.getTime(), boundary(dateKey, window.start))
        to = boundary(dateKey, window.end)
      } catch {
        throw new SlaCalendarError("SLA_CALENDAR_BOUNDARY_INVALID")
      }
      for (const [pauseFrom, pauseTo] of [...excluded, [Infinity, Infinity]]) {
        if (pauseTo <= from) continue
        const stop = Math.min(to, pauseFrom)
        const available = Math.max(0, stop - from)
        if (remaining <= available) return new Date(from + remaining)
        remaining -= available
        from = Math.max(from, pauseTo)
        if (from >= to) break
      }
    }
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1)
  }
  throw new SlaCalendarError("SLA_CALENDAR_LIMIT")
}
