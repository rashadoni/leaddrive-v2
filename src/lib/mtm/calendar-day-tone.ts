/**
 * How a calendar cell is shaded (field UX audit 2026-09-05, task C6).
 *
 * The month grid drew every cell of the current month identically, so a
 * manager scanning for "where can I still plan something" had to read the
 * dates. Days that are over are not a planning surface; dimming them costs
 * nothing and removes half the grid from the search.
 *
 * Comparison is by local calendar day, not by instant: a route planned for
 * today stays a today at 23:59, and "past" must not start at midnight UTC for
 * a tenant in Baku.
 */
export function mtmCalendarDayKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-")
}

/** True when the day is over — strictly before today, never today itself. */
export function isPastMtmCalendarDay(day: Date, today: Date = new Date()): boolean {
  return mtmCalendarDayKey(day) < mtmCalendarDayKey(today)
}
