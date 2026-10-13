import { z } from "zod"

/** An organization rule for new hourly time-off submissions, not a leave balance. */
export const DEFAULT_ATTENDANCE_REQUEST_LIMITS = { monthlyMinutes: 480, monthlyRequests: 3 } as const
export const AttendanceRequestLimitsSchema = z.object({
  monthlyMinutes: z.number().int().min(0).max(744 * 60).multipleOf(30),
  monthlyRequests: z.number().int().min(0).max(100),
}).strict()
export const AttendanceRequestLimitsUpdateSchema = AttendanceRequestLimitsSchema.extend({ version: z.string().datetime().nullable() })
export type AttendanceRequestLimitValues = z.infer<typeof AttendanceRequestLimitsSchema>
export type AttendanceRequestLimits = AttendanceRequestLimitValues & { version: string | null }
export type AttendanceRequestLimitUsage = { usedMinutes: number; usedRequests: number }

export function isAttendanceRequestLimited(input: { kind: string; unit: string }): boolean {
  return input.unit === "HOURS" && (input.kind === "HOURLY_ABSENCE" || input.kind === "TIME_OFF")
}

/** Count a distinct new submission once; UUID replays must return before this check. */
export function attendanceRequestLimitDecision(limits: AttendanceRequestLimitValues, usage: AttendanceRequestLimitUsage, requestedMinutes: number):
  null | "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT" | "MTM_ATTENDANCE_REQUEST_COUNT_LIMIT" {
  // Unknown/corrupt values never turn into an unlimited allowance.
  const values = AttendanceRequestLimitsSchema.parse({ monthlyMinutes: limits.monthlyMinutes, monthlyRequests: limits.monthlyRequests })
  if (!Number.isSafeInteger(usage.usedMinutes) || usage.usedMinutes < 0 || !Number.isSafeInteger(usage.usedRequests) || usage.usedRequests < 0
    || !Number.isSafeInteger(requestedMinutes) || requestedMinutes <= 0) throw new Error("MTM_ATTENDANCE_REQUEST_LIMIT_USAGE_INVALID")
  if (values.monthlyRequests === 0 || usage.usedRequests >= values.monthlyRequests) return "MTM_ATTENDANCE_REQUEST_COUNT_LIMIT"
  if (values.monthlyMinutes === 0 || requestedMinutes > values.monthlyMinutes - usage.usedMinutes) return "MTM_ATTENDANCE_REQUEST_MINUTES_LIMIT"
  return null
}
