/**
 * «Təqvim» on a board — Bordio's Calendar tool (owner, 2026-11-06): the board's
 * tasks laid out by their due date over a month.
 *
 * A due date is an instant; the day it falls on is the viewer's own day
 * (`dayKey`, the browser's time zone by default). A Bordio due date without a
 * time was brought over as 19:59:59Z — the end of that day in Baku — so it
 * lands on the same day there.
 */

export interface CalendarDay {
  /** YYYY-MM-DD */
  key: string
  day: number
  inMonth: boolean
}

const pad = (value: number) => String(value).padStart(2, "0")

export function localDayKey(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** Six Monday-first weeks covering the month (`month0` is 0-based). */
export function monthWeeks(year: number, month0: number): CalendarDay[][] {
  const first = new Date(year, month0, 1)
  const lead = (first.getDay() + 6) % 7 // days before the 1st since Monday
  const start = new Date(year, month0, 1 - lead)
  const weeks: CalendarDay[][] = []
  for (let w = 0; w < 6; w += 1) {
    const week: CalendarDay[] = []
    for (let d = 0; d < 7; d += 1) {
      const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)
      week.push({ key: localDayKey(at), day: at.getDate(), inMonth: at.getMonth() === month0 })
    }
    weeks.push(week)
  }
  return weeks
}

/** Tasks grouped by the day their deadline falls on; tasks without one are counted apart. */
export function tasksByDueDay<T extends { dueDate: string | null }>(
  tasks: readonly T[],
  dayKey: (at: Date) => string = localDayKey,
): { byDay: Map<string, T[]>; undated: number } {
  const byDay = new Map<string, T[]>()
  let undated = 0
  for (const task of tasks) {
    if (!task.dueDate) { undated += 1; continue }
    const at = new Date(task.dueDate)
    if (Number.isNaN(at.getTime())) { undated += 1; continue }
    const key = dayKey(at)
    const list = byDay.get(key)
    if (list) list.push(task)
    else byDay.set(key, [task])
  }
  return { byDay, undated }
}
