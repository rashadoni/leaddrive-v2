/** Personnel → Settings is one page of cards grouped by meaning (owner,
 * 2026-10-14: nine tabs were too many). A plain module: the server page and the
 * client hub both read it, and a value from a "use client" file reaches a
 * server component as a stub. Each card opens `?tab=<key>`. */
export const ATTENDANCE_SETTINGS_GROUPS = [
  { key: "workday", cards: ["hours", "holidays", "shifts", "day-kinds"] },
  { key: "leave", cards: ["leave", "requests"] },
  { key: "marks", cards: ["review", "qr", "location"] },
  { key: "access", cards: ["access"] },
] as const
export type AttendanceSettingsCard = (typeof ATTENDANCE_SETTINGS_GROUPS)[number]["cards"][number]
export const ATTENDANCE_SETTINGS_CARDS: readonly AttendanceSettingsCard[] = ATTENDANCE_SETTINGS_GROUPS.flatMap(group => [...group.cards])
/** Administrator-only like their endpoints. */
export const ATTENDANCE_ADMIN_SETTINGS: readonly AttendanceSettingsCard[] = ["location"]

/** Working days as runs: [1,2,3,4,5] → "Mon–Fri", [1,2,4] → "Mon, Tue, Thu".
 * `weekendDays` uses JavaScript's numbering (0 = Sunday); the week starts on Monday. */
export function attendanceWorkWeek(weekendDays: readonly number[], dayName: (day: number) => string): string {
  const working = [1, 2, 3, 4, 5, 6, 0].filter(day => !weekendDays.includes(day))
  const runs: number[][] = []
  for (const day of working) {
    const run = runs.at(-1)
    const previous = run?.at(-1)
    if (run && previous !== undefined && (previous + 1) % 7 === day) run.push(day)
    else runs.push([day])
  }
  return runs.map(run => run.length > 2 ? `${dayName(run[0])}–${dayName(run.at(-1)!)}` : run.map(dayName).join(", ")).join(", ")
}
