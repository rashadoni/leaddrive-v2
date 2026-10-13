import type { AttendanceRequestDetails } from "@/lib/mtm/attendance-request-contract"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { localDateTimeToUnambiguousUtc } from "@/lib/timezone"

/** Allowlist shared by reports and exports; request reasons/documents stay in the review queue. */
export type AttendanceApprovedPeriod = {
  id: string; agentId: string; startDate: string; endDate: string; decidedAt: string
  details: Pick<AttendanceRequestDetails, "kind" | "unit" | "startTime" | "endTime" | "timezone" | "dayKind">
}
const ABSENCE_KINDS = new Set(["ANNUAL_LEAVE", "SICK_LEAVE", "TIME_OFF", "HOURLY_ABSENCE"])

export function isAttendanceApprovedAbsence(period: AttendanceApprovedPeriod) {
  return ABSENCE_KINDS.has(period.details.kind) || (period.details.kind === "HR_RECORD" && ["PAID_LEAVE", "UNPAID_LEAVE"].includes(period.details.dayKind.group))
}

/** Frozen request clocks are interpreted in their original timezone. A broken
 * or ambiguous legacy clock must never silently excuse a violation. */
export function attendanceApprovedAbsenceWindow(period: AttendanceApprovedPeriod): [number, number] | null {
  if (!isAttendanceApprovedAbsence(period)) return null
  const { unit, startTime, endTime, timezone } = period.details
  if (unit === "HOURS" && (!startTime || !endTime)) return null
  try {
    const from = localDateTimeToUnambiguousUtc(`${period.startDate}T${unit === "DAYS" ? "00:00" : startTime}`, timezone).getTime()
    const to = localDateTimeToUnambiguousUtc(`${unit === "DAYS" ? addDateKeyDays(period.endDate, 1) : period.endDate}T${unit === "DAYS" ? "00:00" : endTime}`, timezone).getTime()
    return to > from ? [from, to] : null
  } catch { return null }
}

/** Union intersections so duplicate/overlapping imported approvals cannot
 * deduct the same second twice. No work or break facts are recalculated. */
function uncoveredSeconds(from: string | null, to: string | null, windows: [number, number][], fallback: number): number {
  if (!from || !to) return fallback
  const start = Date.parse(from), end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fallback
  const clipped = windows.map(([a, b]) => [Math.max(start, a), Math.min(end, b)])
    .filter(([a, b]) => b > a).sort(([a], [b]) => a - b)
  let covered = 0, cursor = start
  for (const [a, b] of clipped) {
    covered += Math.max(0, b - Math.max(cursor, a))
    cursor = Math.max(cursor, b)
  }
  return Math.min(fallback, Math.max(0, Math.floor((end - start - covered) / 1000)))
}

export function projectApprovedAttendanceRequests(row: MtmAttendanceReportRow, periods: readonly AttendanceApprovedPeriod[], lateGraceSeconds = 0): MtmAttendanceReportRow {
  const approved = periods.filter((entry) => entry.agentId === row.employeeId && entry.startDate <= row.date && entry.endDate >= row.date && entry.details.kind !== "TIME_CORRECTION")
  if (!approved.length) return row
  const annualLeaveDays = approved.some(period => period.details.unit === "DAYS" && period.details.dayKind.key === "ANNUAL_LEAVE")
    && !["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"].includes(row.calendarKind) ? 1 : 0
  let result = { ...row, approvedRequests: approved, annualLeaveDays }
  if (row.factsState === "INVALID") return result
  const windows = approved.map(attendanceApprovedAbsenceWindow).filter((window): window is [number, number] => window !== null)
  if (windows.length && row.factsState === "VALID" && row.isWorkingDay) {
    const uncoveredLate = row.lateSeconds === null ? null : uncoveredSeconds(row.plannedStartAt, row.startedAt, windows, row.lateSeconds)
    const lateSeconds = uncoveredLate !== null && uncoveredLate <= lateGraceSeconds ? 0 : uncoveredLate
    const earlyLeaveSeconds = row.earlyLeaveSeconds === null ? null : uncoveredSeconds(row.completedAt, row.plannedEndAt, windows, row.earlyLeaveSeconds)
    result = { ...result, lateSeconds, earlyLeaveSeconds, flags: row.flags.filter(flag =>
      (flag !== "LATE_START" || (lateSeconds ?? 0) > 0) && (flag !== "EARLY_LEAVE" || (earlyLeaveSeconds ?? 0) > 0)) }
  }
  const whole = approved.find((entry) => entry.details.unit === "DAYS")
  if (!whole) return result
  // A public holiday remains a holiday inside leave. This projection never
  // overwrites the company calendar or manufactures worked hours.
  const absence = isAttendanceApprovedAbsence(whole)
  if (whole.details.dayKind.key === "ANNUAL_LEAVE" && ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"].includes(row.calendarKind)) return result
  if (row.workdayId) {
    return absence
      ? { ...result, flags: [...new Set([...result.flags, "WORKED_ON_APPROVED_ABSENCE" as const])] }
      : result
  }
  if (whole.details.kind === "HR_RECORD" && whole.details.dayKind.group === "VIOLATION") return { ...result, dayKind: whole.details.dayKind }
  return { ...result, kind: "APPROVED_REQUEST", dayKind: whole.details.dayKind,
    expectedWorkSeconds: absence ? 0 : row.expectedWorkSeconds }
}
