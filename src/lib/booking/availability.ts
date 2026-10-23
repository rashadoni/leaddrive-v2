/**
 * Free time on a booking page — the slots a customer may pick.
 *
 * A slot is a start time on the organization's clock, every `durationMinutes`
 * from the start of a working-hours interval, that
 *   - ends inside that interval,
 *   - is at least `minNoticeMinutes` away,
 *   - lies within `maxDaysAhead` days (today counts as day 0),
 *   - and has at least one host free for the whole meeting plus the buffer on
 *     both sides. Busy time is the host's booked meetings, the CRM tasks given
 *     a time, and — when connected — their Google Calendar.
 *
 * Pure: the caller loads busy intervals. The same function decides what the
 * page shows and whether a submitted slot is still free, so the two cannot
 * disagree.
 */
import { dateInputValueInTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"

export const WEEKDAYS = ["0", "1", "2", "3", "4", "5", "6"] as const // 0 = Sunday
export type Weekday = (typeof WEEKDAYS)[number]

export interface HoursInterval {
  /** "HH:mm" on the organization's clock. */
  start: string
  end: string
}

export type WeeklyHours = Record<Weekday, HoursInterval[]>

export interface BookingRules {
  timezone: string
  durationMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  weekly: WeeklyHours
}

export interface BusyInterval {
  start: Date
  end: Date
}

export interface Slot {
  /** UTC instant, ISO. */
  startsAt: string
  endsAt: string
  /** Hosts free for this slot, in the order given. */
  hostIds: string[]
}

export interface DaySlots {
  /** "YYYY-MM-DD" on the organization's clock. */
  date: string
  slots: Slot[]
}

/** Monday to Friday, 09:00–18:00. */
export function defaultWeeklyHours(): WeeklyHours {
  const day = [{ start: "09:00", end: "18:00" }]
  return { "0": [], "1": day, "2": day, "3": day, "4": day, "5": day, "6": [] }
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function minutesOfDay(value: string): number | null {
  const match = TIME.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** The organization-clock date `days` after `date` ("YYYY-MM-DD"). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number)
  return String(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) as Weekday
}

function overlaps(a: BusyInterval, start: number, end: number): boolean {
  return a.start.getTime() < end && a.end.getTime() > start
}

export function computeSlots(input: {
  rules: BookingRules
  hostIds: string[]
  busyByHost: Map<string, BusyInterval[]>
  now: Date
}): DaySlots[] {
  const { rules, hostIds, busyByHost, now } = input
  const duration = rules.durationMinutes * 60_000
  const buffer = rules.bufferMinutes * 60_000
  const earliest = now.getTime() + rules.minNoticeMinutes * 60_000
  const today = dateInputValueInTimezone(now, rules.timezone)
  const days: DaySlots[] = []

  for (let offset = 0; offset <= rules.maxDaysAhead; offset += 1) {
    const date = addDays(today, offset)
    const slots: Slot[] = []
    for (const interval of rules.weekly[weekdayOf(date)] ?? []) {
      const from = minutesOfDay(interval.start)
      const to = minutesOfDay(interval.end)
      if (from === null || to === null) continue
      for (let minute = from; minute + rules.durationMinutes <= to; minute += rules.durationMinutes) {
        let start: Date
        try {
          // A clock time that does not exist that day (a DST gap) or exists
          // twice is skipped rather than guessed.
          start = localDateTimeToUnambiguousUtc(`${date}T${clock(minute)}`, rules.timezone)
        } catch {
          continue
        }
        if (start.getTime() < earliest) continue
        const end = start.getTime() + duration
        const free = hostIds.filter((hostId) =>
          !(busyByHost.get(hostId) ?? []).some((busy) => overlaps(busy, start.getTime() - buffer, end + buffer)))
        if (free.length === 0) continue
        slots.push({ startsAt: start.toISOString(), endsAt: new Date(end).toISOString(), hostIds: free })
      }
    }
    if (slots.length > 0) days.push({ date, slots })
  }
  return days
}

/** The slot starting at `startsAt`, if it is offered. */
export function findSlot(days: DaySlots[], startsAt: string): Slot | null {
  const target = new Date(startsAt).getTime()
  for (const day of days) {
    for (const slot of day.slots) {
      if (new Date(slot.startsAt).getTime() === target) return slot
    }
  }
  return null
}

/**
 * Validate and normalise a weekly-hours object from a form: intervals sorted,
 * each with start before end, none overlapping.
 */
export function parseWeeklyHours(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const result = {} as WeeklyHours
  for (const day of WEEKDAYS) {
    const raw = record[day] ?? []
    if (!Array.isArray(raw) || raw.length > 6) return null
    const intervals: { start: string; end: string; from: number; to: number }[] = []
    for (const item of raw) {
      if (!item || typeof item !== "object") return null
      const { start, end } = item as Record<string, unknown>
      if (typeof start !== "string" || typeof end !== "string") return null
      const from = minutesOfDay(start)
      const to = minutesOfDay(end)
      if (from === null || to === null || from >= to) return null
      intervals.push({ start, end, from, to })
    }
    intervals.sort((a, b) => a.from - b.from)
    for (let i = 1; i < intervals.length; i += 1) {
      if (intervals[i].from < intervals[i - 1].to) return null
    }
    result[day] = intervals.map(({ start, end }) => ({ start, end }))
  }
  return result
}
