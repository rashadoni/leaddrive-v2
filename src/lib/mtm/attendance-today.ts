import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"

/** Days before today in which a missing finish still asks for HR attention. */
export const ATTENDANCE_TODAY_LOOKBACK_DAYS = 7

export type AttendanceTodayAttention =
  | { type: "absent"; employeeId: string; employeeName: string; teamName: string | null; date: string }
  | { type: "late"; employeeId: string; employeeName: string; teamName: string | null; date: string; lateSeconds: number; startedAt: string; timezone: string }
  | { type: "missing-finish"; employeeId: string; employeeName: string; teamName: string | null; date: string }

export type AttendanceTodayDay = { date: string; future: boolean; expected: number; present: number; late: number; away: number; absent: number }

/** Monday of the week containing `date` (date keys are calendar days, no zone). */
export function attendanceWeekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  return addDateKeyDays(date, -((weekday + 6) % 7))
}

/** The report period the Today screen reads: the week, plus the lookback. */
export function attendanceTodayRange(today: string) {
  const weekStart = attendanceWeekStart(today)
  const lookback = addDateKeyDays(today, -ATTENDANCE_TODAY_LOOKBACK_DAYS)
  return { from: lookback < weekStart ? lookback : weekStart, to: addDateKeyDays(weekStart, 6), weekStart }
}

// A day the person is expected at work: a working calendar day, employed, and
// not covered by an approved absence. Approved remote work or a trip still
// counts once the person actually marked the start.
const expectedOn = (row: MtmAttendanceReportRow) => row.isWorkingDay && row.kind !== "NOT_EMPLOYED"
  && (row.kind !== "APPROVED_REQUEST" || row.startedAt !== null)
const awayOn = (row: MtmAttendanceReportRow) => row.kind === "APPROVED_REQUEST" && row.startedAt === null
const presentOn = (row: MtmAttendanceReportRow) => row.startedAt !== null && row.factsState === "VALID"
const lateOn = (row: MtmAttendanceReportRow) => (row.lateSeconds ?? 0) > 0

/**
 * Everything the Personnel → Today screen shows, from one report snapshot.
 * Counting rules are the report's own (`summarizeMtmAttendanceRows`): arrived
 * means a valid recorded start, absent means the report's ABSENT kind (no
 * approved reason), missing finish is the report's MISSING_FINISH kind.
 */
export function summarizeAttendanceToday(rows: readonly MtmAttendanceReportRow[], today: string) {
  const { weekStart } = attendanceTodayRange(today)
  const lookback = addDateKeyDays(today, -ATTENDANCE_TODAY_LOOKBACK_DAYS)
  const todayRows = rows.filter(row => row.date === today)
  const missing = rows.filter(row => row.kind === "MISSING_FINISH" && row.date < today && row.date >= lookback)
  const attention: AttendanceTodayAttention[] = [
    ...todayRows.filter(row => row.kind === "ABSENT").map(row => ({ type: "absent" as const, employeeId: row.employeeId, employeeName: row.employeeName, teamName: row.teamName, date: row.date })),
    ...todayRows.filter(row => lateOn(row) && row.startedAt).sort((a, b) => (b.lateSeconds ?? 0) - (a.lateSeconds ?? 0)).map(row => ({
      type: "late" as const, employeeId: row.employeeId, employeeName: row.employeeName, teamName: row.teamName, date: row.date,
      lateSeconds: row.lateSeconds ?? 0, startedAt: row.startedAt!, timezone: row.timezone })),
    ...missing.sort((a, b) => b.date.localeCompare(a.date)).map(row => ({ type: "missing-finish" as const, employeeId: row.employeeId, employeeName: row.employeeName, teamName: row.teamName, date: row.date })),
  ]
  const people = new Set(rows.filter(row => row.kind !== "NOT_EMPLOYED").map(row => row.employeeId))
  const flagged = new Set(attention.map(item => item.employeeId))
  const week: AttendanceTodayDay[] = []
  for (let index = 0; index < 7; index++) {
    const date = addDateKeyDays(weekStart, index)
    const day = rows.filter(row => row.date === date)
    const expected = day.filter(expectedOn).length
    // Weekend columns appear only when somebody is scheduled to work them.
    if (index >= 5 && expected === 0) continue
    week.push({ date, future: date > today, expected, present: day.filter(presentOn).length, late: day.filter(lateOn).length,
      away: day.filter(awayOn).length, absent: day.filter(row => row.kind === "ABSENT").length })
  }
  return {
    expected: todayRows.filter(expectedOn).length,
    arrived: todayRows.filter(presentOn).length,
    late: todayRows.filter(lateOn).length,
    absent: todayRows.filter(row => row.kind === "ABSENT").length,
    away: todayRows.filter(awayOn).length,
    missingFinish: missing.length,
    attention,
    /** People in tracking with nothing for HR to look at. */
    quiet: [...people].filter(id => !flagged.has(id)).length,
    people: people.size,
    week,
  }
}

export type AttendanceTodaySummary = ReturnType<typeof summarizeAttendanceToday>
