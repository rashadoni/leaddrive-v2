/**
 * «Təqvim» of «Mənim işlərim» — Bordio's My work → Calendar (owner, 2026-11-10:
 * «Да, под Bordio» → «Давай, по макету»).
 *
 * Days run as columns, one step at a time; the waiting list holds one's open
 * tasks that have no day yet. The day a task is planned for is its «Başlama
 * tarixi» (Task.startDate, local midnight — as the task panel writes it), NOT
 * its due date: in Bordio too a task due on 2 Nov sat in the waiting list,
 * not on 2 Nov. Moving a task between days never touches its deadline.
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
  startDate?: string | null
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

/** What the task panel writes for a picked day: that day's local midnight. */
export function startDateForDay(key: string): string {
  return new Date(`${key}T00:00:00`).toISOString()
}

/** The planned day of a task, or null. */
export function plannedDay(task: { startDate?: string | null }): string | null {
  if (!task.startDate) return null
  const at = new Date(task.startDate)
  return Number.isNaN(at.getTime()) ? null : localDayKey(at)
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
const dueTime = (t: PlannedTask) => (t.dueDate ? new Date(t.dueDate).getTime() : Infinity)

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
      if (!isClosed(task.status)) waiting.push(task)
      continue
    }
    if (shown.has(day)) byDay.get(day)!.push(task)
  }
  waiting.sort((a, b) => dueTime(a) - dueTime(b) || rank(a.priority) - rank(b.priority) || a.title.localeCompare(b.title))
  for (const list of byDay.values()) {
    list.sort((a, b) => Number(isClosed(a.status)) - Number(isClosed(b.status)) || rank(a.priority) - rank(b.priority) || a.title.localeCompare(b.title))
  }
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
