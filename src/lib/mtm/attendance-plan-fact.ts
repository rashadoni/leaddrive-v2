import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { attendanceCountedOvertimeSeconds, attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"

/**
 * One employee's day as «plan / fact» — owner, 2026-11-01, after the HRSS clip
 * («Kim işdədir? Canlı baxın»): the schedule, the marks, worked against the
 * norm, and each deviation, in one place. Every figure is the report's own
 * (attendance-report.ts), so the card can never disagree with the timesheet.
 *
 * `null` is «not known» and is drawn as «—»; 0 is a real zero.
 */
export type AttendanceDayPlanFact = {
  /** The schedule window for a working day; null on a day off. */
  plan: { start: string; end: string } | null
  actual: { start: string | null; end: string | null; open: boolean }
  workedSeconds: number | null
  normSeconds: number
  /** A finished working day with less than the norm worked. */
  short: boolean
  lateSeconds: number | null
  earlyLeaveSeconds: number | null
  pausedSeconds: number | null
  /** Lunch taken off the worked time without a break pressed — part of `pausedSeconds`'s story, not of it. */
  lunchAutoSeconds: number
  /** What counts as overtime on the timesheet; null while the day is not finished. */
  overtimeSeconds: number | null
}

export function attendanceDayPlanFact(row: MtmAttendanceReportRow): AttendanceDayPlanFact {
  const overtime = attendanceOvertimeRows([row])[0]
  const open = row.kind === "OPEN" || (row.startedAt !== null && row.completedAt === null)
  const finished = row.factsState === "VALID" && row.completedAt !== null && !open
  return {
    plan: row.isWorkingDay && row.plannedStartAt && row.plannedEndAt ? { start: row.plannedStartAt, end: row.plannedEndAt } : null,
    actual: { start: row.startedAt, end: row.completedAt, open },
    workedSeconds: row.workedSeconds,
    normSeconds: row.expectedWorkSeconds,
    short: finished && row.isWorkingDay && row.workedSeconds !== null && row.workedSeconds < row.expectedWorkSeconds,
    lateSeconds: row.lateSeconds,
    earlyLeaveSeconds: row.earlyLeaveSeconds,
    pausedSeconds: row.pausedSeconds,
    lunchAutoSeconds: row.lunchAutoSeconds ?? 0,
    overtimeSeconds: overtime && overtime.state !== "UNKNOWN" ? attendanceCountedOvertimeSeconds(overtime) : null,
  }
}
