import { z } from "zod"

/** An organization rule for new hourly time-off submissions, not a leave balance. */
/**
 * `leaveNoticeDays` — how many days before its start an annual leave should be
 * asked for (owner, 2026-11-01, after the HRSS clip: «Qeyd: məzuniyyət
 * ərizəsinin ən azı 5 gün əvvəl verilməsi tövsiyə olunur»). A recommendation:
 * the phone says it in the leave form and HR sees a later request marked, but
 * nothing is refused. 0 — off, the default.
 */
export const DEFAULT_ATTENDANCE_REQUEST_LIMITS = { monthlyMinutes: 480, monthlyRequests: 3, leaveNoticeDays: 0 } as const
export const ATTENDANCE_LEAVE_NOTICE_MAX_DAYS = 90
const leaveNoticeDays = z.number().int().min(0).max(ATTENDANCE_LEAVE_NOTICE_MAX_DAYS)
export const AttendanceRequestLimitsSchema = z.object({
  monthlyMinutes: z.number().int().min(0).max(744 * 60).multipleOf(30),
  monthlyRequests: z.number().int().min(0).max(100),
  // Stored before the notice existed: read as off.
  leaveNoticeDays: leaveNoticeDays.default(0),
}).strict()
/** Without `leaveNoticeDays` (a tab opened before it existed) the saved notice stays as it is. */
export const AttendanceRequestLimitsUpdateSchema = AttendanceRequestLimitsSchema.extend({ leaveNoticeDays: leaveNoticeDays.optional(), version: z.string().datetime().nullable() })
export type AttendanceRequestLimitValues = z.infer<typeof AttendanceRequestLimitsSchema>
export type AttendanceRequestLimits = AttendanceRequestLimitValues & { version: string | null }
export type AttendanceRequestLimitUsage = { usedMinutes: number; usedRequests: number }

export function isAttendanceRequestLimited(input: { kind: string; unit: string }): boolean {
  return input.unit === "HOURS" && (input.kind === "HOURLY_ABSENCE" || input.kind === "TIME_OFF")
}

/** Count a distinct new submission once; UUID replays must return before this check. */
export function attendanceRequestLimitDecision(limits: Pick<AttendanceRequestLimitValues, "monthlyMinutes" | "monthlyRequests">, usage: AttendanceRequestLimitUsage, requestedMinutes: number):
  null | "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT" | "MTM_ATTENDANCE_REQUEST_COUNT_LIMIT" {
  // Unknown/corrupt values never turn into an unlimited allowance.
  const values = AttendanceRequestLimitsSchema.parse({ monthlyMinutes: limits.monthlyMinutes, monthlyRequests: limits.monthlyRequests })
  if (!Number.isSafeInteger(usage.usedMinutes) || usage.usedMinutes < 0 || !Number.isSafeInteger(usage.usedRequests) || usage.usedRequests < 0
    || !Number.isSafeInteger(requestedMinutes) || requestedMinutes <= 0) throw new Error("MTM_ATTENDANCE_REQUEST_LIMIT_USAGE_INVALID")
  if (values.monthlyRequests === 0 || usage.usedRequests >= values.monthlyRequests) return "MTM_ATTENDANCE_REQUEST_COUNT_LIMIT"
  if (values.monthlyMinutes === 0 || requestedMinutes > values.monthlyMinutes - usage.usedMinutes) return "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT"
  return null
}

/**
 * An annual leave asked for later than the company's notice: how many days
 * before its start it came in. Dates are the request's own (its time zone).
 * `null` when there is no notice, the kind is not annual leave, or it came in time.
 */
export function attendanceLateLeaveNotice(input: { kind: string; startDate: string; submittedDate: string }, noticeDays: number): { days: number; required: number } | null {
  if (input.kind !== "ANNUAL_LEAVE" || !Number.isSafeInteger(noticeDays) || noticeDays <= 0) return null
  const days = Math.round((Date.parse(`${input.startDate}T00:00:00Z`) - Date.parse(`${input.submittedDate}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(days) && days < noticeDays ? { days: Math.max(0, days), required: noticeDays } : null
}
