/**
 * «Təqvim» of «Mənim işlərim» — Bordio's My work → Calendar (owner, 2026-11-10:
 * «Да, под Bordio» → «Давай, по макету»).
 *
 * Days run as columns, one step at a time; the waiting list holds one's open
 * tasks that have no day yet. The day is the person's OWN plan for the task
 * (TaskPlan — owner, 2026-11-10: «Да, свой у каждого»): in Bordio every
 * assignee places the same task on their own day, and a task due on 2 Nov can
 * sit in the waiting list. Moving a task between days touches nobody else's
 * calendar and never the deadline. The list API hands the caller's plan as
 * `plans: [{ day }]` (a calendar day, written as midnight UTC).
 */
import { localDayKey } from "@/lib/tasks/board-calendar"
import { CLOSED_TASK_STATUSES } from "@/lib/tasks/my-work"

export { localDayKey }

export interface PlannedTask {
  id: string
  title: string
  status: string
  priority?: string | null
  dueDate: string | null
  /** The caller's own plan for the task — at most one; empty = waiting list. */
  plans?: { day: string; rank?: number | null }[] | null
}

const isClosed = (status: string) => (CLOSED_TASK_STATUSES as readonly string[]).includes(status)

/** The day key `n` days after `key` (negative goes back), in the viewer's calendar. */
export function shiftDayKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  return localDayKey(new Date(y, m - 1, d + n))
}

/** `count` consecutive day keys from `first`. */
export function dayKeys(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDayKey(first, i))
}

/** How a plan for a day comes back from the API (a DATE column, serialised at midnight UTC). */
export function planForDay(key: string, rank: number | null = null): { day: string; rank: number | null } {
  return { day: `${key}T00:00:00.000Z`, rank }
}

const planRank = (task: { plans?: { rank?: number | null }[] | null }) => task.plans?.[0]?.rank ?? null

/**
 * The rank that puts a card between two others in a day (ascending); with
 * nothing below it goes under `before`, with nothing above it over `after`.
 */
export function rankBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before != null && after != null) return (before + after) / 2
  if (before != null) return before + 1_000_000
  if (after != null) return after - 1_000_000
  return Date.now()
}

/** Where a card dropped on `target` lands: just above it, below the card that was there. */
export function rankBefore(dayList: readonly PlannedTask[], targetId: string, movingId: string): number {
  const list = dayList.filter((task) => task.id !== movingId)
  const at = list.findIndex((task) => task.id === targetId)
  if (at < 0) return rankBetween(planRank(list[list.length - 1] ?? {}), null)
  return rankBetween(at > 0 ? planRank(list[at - 1]) : null, planRank(list[at]))
}

/** The caller's planned day of a task, or null (waiting list). A calendar day: no time zone moves it. */
export function plannedDay(task: { plans?: { day: string }[] | null }): string | null {
  const day = task.plans?.[0]?.day
  return day && /^\d{4}-\d{2}-\d{2}/u.test(day) ? day.slice(0, 10) : null
}

const DAY_MIN_PX = 220
const WAITING_PX = 280

/** How many day columns fit — as in Bordio, the width decides (3–4 on a laptop, 1 on a phone). */
export function visibleDayCount(width: number): number {
  if (width < 640) return 1
  return Math.max(1, Math.min(7, Math.floor((width - WAITING_PX) / DAY_MIN_PX)))
}

/** The first column: today, or yesterday when three or more days fit (Bordio keeps one day behind in view). */
export function firstDayFor(today: string, count: number): string {
  return count >= 3 ? shiftDayKey(today, -1) : today
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 }
const rank = (p?: string | null) => PRIORITY_RANK[p ?? ""] ?? 4

/**
 * The waiting list (open tasks with no day, most pressing first — the latest
 * deadline last, no deadline at the end) and each shown day's tasks (open
 * ones first by priority, finished ones after, greyed by the caller).
 */
export function planTasks<T extends PlannedTask>(
  open: readonly T[],
  finished: readonly T[],
  days: readonly string[],
): { waiting: T[]; byDay: Map<string, T[]> } {
  const shown = new Set(days)
  const byDay = new Map<string, T[]>(days.map((d) => [d, []]))
  const waiting: T[] = []
  const seen = new Set<string>()
  for (const task of [...open, ...finished]) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    const day = plannedDay(task)
    if (!day) {
      // As in Bordio, finished tasks without a day wait here too (53 Sabunçu,
      // completed, sat in Nazrin's Waiting list of 146 — owner, 2026-11-10:
      // «сделай как в бордио»).
      waiting.push(task)
      continue
    }
    if (shown.has(day)) byDay.get(day)!.push(task)
  }
  // Bordio's order: the latest deadline first (due tomorrow, then 8, 19, 22
  // days ago …); no deadline at the end.
  const dueDesc = (t: PlannedTask) => (t.dueDate ? -new Date(t.dueDate).getTime() : Infinity)
  waiting.sort((a, b) => dueDesc(a) - dueDesc(b) || rank(a.priority) - rank(b.priority) || a.title.localeCompare(b.title))
  // Inside a day: the person's own order, as in Bordio (finished cards stay in
  // their place); cards without one after, by priority and title.
  const byRank = (a: T, b: T) => {
    const ra = planRank(a), rb = planRank(b)
    if (ra !== null && rb !== null && ra !== rb) return ra - rb
    if ((ra === null) !== (rb === null)) return ra === null ? 1 : -1
    return rank(a.priority) - rank(b.priority) || a.title.localeCompare(b.title)
  }
  for (const list of byDay.values()) list.sort(byRank)
  return { waiting, byDay }
}

export type DueNote =
  | { kind: "none" }
  | { kind: "late"; days: number }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "date"; date: Date }

/** «8 gün gecikib» / «son gün bu gün» / «sabah son gün» / the date — by calendar days, not hours. */
export function dueNote(dueDate: string | null | undefined, now: Date = new Date()): DueNote {
  if (!dueDate) return { kind: "none" }
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return { kind: "none" }
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(due) - start(now)) / 86_400_000)
  if (days < 0) return { kind: "late", days: -days }
  if (days === 0) return { kind: "today" }
  if (days === 1) return { kind: "tomorrow" }
  return { kind: "date", date: due }
}

export { isClosed as isClosedStatus }
