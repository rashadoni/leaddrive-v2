import type { AttendanceRequestDetails } from "@/lib/mtm/attendance-request-contract"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"

/** Allowlist shared by reports and exports; request reasons/documents stay in the review queue. */
export type AttendanceApprovedPeriod = {
  id: string; agentId: string; startDate: string; endDate: string; decidedAt: string
  details: Pick<AttendanceRequestDetails, "kind" | "unit" | "startTime" | "endTime" | "timezone" | "dayKind">
}
const ABSENCE_KINDS = new Set(["ANNUAL_LEAVE", "SICK_LEAVE", "TIME_OFF", "HOURLY_ABSENCE"])

export function projectApprovedAttendanceRequests(row: MtmAttendanceReportRow, periods: readonly AttendanceApprovedPeriod[]): MtmAttendanceReportRow {
  const approved = periods.filter((entry) => entry.agentId === row.employeeId && entry.startDate <= row.date && entry.endDate >= row.date && entry.details.kind !== "TIME_CORRECTION")
  if (!approved.length) return row
  const result = { ...row, approvedRequests: approved }
  if (row.factsState === "INVALID") return result
  const whole = approved.find((entry) => entry.details.unit === "DAYS")
  if (!whole) return result
  // A public holiday remains a holiday inside leave. This projection never
  // overwrites the company calendar or manufactures worked hours.
  const absence = ABSENCE_KINDS.has(whole.details.kind) || (whole.details.kind === "HR_RECORD" && ["PAID_LEAVE", "UNPAID_LEAVE"].includes(whole.details.dayKind.group))
  if (whole.details.dayKind.key === "ANNUAL_LEAVE" && ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"].includes(row.calendarKind)) return result
  if (row.workdayId) {
    return absence
      ? { ...result, flags: [...new Set([...row.flags, "WORKED_ON_APPROVED_ABSENCE" as const])] }
      : result
  }
  if (whole.details.kind === "HR_RECORD" && whole.details.dayKind.group === "VIOLATION") return { ...result, dayKind: whole.details.dayKind }
  return { ...result, kind: "APPROVED_REQUEST", dayKind: whole.details.dayKind,
    expectedWorkSeconds: absence ? 0 : row.expectedWorkSeconds }
}
