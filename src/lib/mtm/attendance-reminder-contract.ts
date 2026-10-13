import { z } from "zod"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import { attendanceApprovedAbsenceWindow, isAttendanceApprovedAbsence } from "@/lib/mtm/attendance-request-projection"
import { mtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"

export const ATTENDANCE_REMINDER_KEYS = ["attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled"] as const
export const AttendanceReminderPolicySchema = z.object({
  attendanceEmployeeRemindersEnabled: z.boolean().optional(),
  attendanceManagerAlertsEnabled: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0)
export const ATTENDANCE_REMINDER_KINDS = ["EMPLOYEE_START", "EMPLOYEE_FINISH", "MANAGER_MISSING", "MANAGER_LATE"] as const
export type AttendanceReminderKind = typeof ATTENDANCE_REMINDER_KINDS[number]
export type AttendanceReminderPolicy = { enabled: boolean; employee: boolean; manager: boolean }
export const ATTENDANCE_REMINDER_ENTITY = "mtm_attendance_reminder"
export const ATTENDANCE_REMINDER_NOTIFICATION_KIND = "mtm.attendanceReminder.detected"
export const ATTENDANCE_REMINDER_URL = "/mtm/attendance"

/** Reports own the calendar and deviation calculation. This only chooses a
 * reminder from their current safe projection; it never calculates work time. */
export function attendanceReminderKinds(row: MtmAttendanceReportRow, now: Date, lateGraceMinutes: number): AttendanceReminderKind[] {
  const instant = now.getTime()
  if (!Number.isFinite(instant) || !row.isWorkingDay || row.expectedWorkSeconds <= 0 || row.employmentState === "NOT_EMPLOYED"
    || row.factsState === "INVALID" || !row.plannedStartAt || !row.plannedEndAt) return []
  const start = Date.parse(row.plannedStartAt), end = Date.parse(row.plannedEndAt)
  const today = currentDateKey(now, row.timezone)
  // An overnight shift keeps its canonical start date. Permit its finish day,
  // but never turn an old ordinary day into a catch-up notification.
  if (row.date !== today && !(row.shiftPlanId && row.date === addDateKeyDays(today, -1)
    && Number.isFinite(end) && currentDateKey(new Date(end), row.timezone) === today)) return []
  const graceMinutes = row.shiftLateGraceMinutes ?? lateGraceMinutes
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isInteger(graceMinutes) || graceMinutes < 0) return []
  // A late imported approval or an hourly absence must not cause a prompt while
  // the employee is currently excused. Malformed absence clocks fail closed.
  const periods = row.approvedRequests ?? []
  if (periods.some(period => {
    const absence = attendanceApprovedAbsenceWindow(period)
    return absence !== null && instant >= absence[0] && instant < absence[1]
  })) return []
  if (periods.some(period => isAttendanceApprovedAbsence(period)
    && attendanceApprovedAbsenceWindow(period) === null)) return []
  const kinds: AttendanceReminderKind[] = []
  if (!row.startedAt && !row.completedAt && instant >= start && instant < end) {
    kinds.push("EMPLOYEE_START")
    if (instant > start + graceMinutes * 60_000 && row.kind === "ABSENT") kinds.push("MANAGER_MISSING")
  }
  if (row.startedAt && !row.completedAt && instant >= end
    && !mtmWorkdayPauses(row.events).some(pause => pause.to === null)) kinds.push("EMPLOYEE_FINISH")
  if (row.startedAt && row.factsState === "VALID" && (row.lateSeconds ?? 0) > 0) kinds.push("MANAGER_LATE")
  return kinds
}
