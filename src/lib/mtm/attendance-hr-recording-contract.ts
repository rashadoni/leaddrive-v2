import { z } from "zod"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { isSystemAttendanceDayKind, type AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"

export const ATTENDANCE_HR_BATCH_LIMIT = 100
const date = z.string().refine(isDateKey)
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
export const AttendanceHrRecordingInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  agentIds: z.array(z.string().min(1).max(191)).min(1).max(ATTENDANCE_HR_BATCH_LIMIT),
  dayKindKey: z.string().min(1).max(64), catalogueVersion: z.string().datetime().nullable(),
  unit: z.enum(["DAYS", "HOURS"]), startDate: date, endDate: date,
  startTime: time.optional(), endTime: time.optional(), reason: z.string().trim().min(3).max(1000),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.agentIds).size !== value.agentIds.length) ctx.addIssue({ code: "custom", path: ["agentIds"], message: "Duplicate employees" })
  if (value.endDate < value.startDate || (isDateKey(value.startDate) && value.endDate > addDateKeyDays(value.startDate, 365))) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Invalid period" })
  if (value.unit === "HOURS" ? value.startDate !== value.endDate || !value.startTime || !value.endTime || value.startTime >= value.endTime : value.startTime || value.endTime) {
    ctx.addIssue({ code: "custom", path: ["endTime"], message: "Invalid time window" })
  }
})
export type AttendanceHrRecordingInput = z.infer<typeof AttendanceHrRecordingInputSchema>
export function canRecordAttendanceDayKind(kind: AttendanceDayKind) {
  return !kind.archived && !isSystemAttendanceDayKind(kind.key) && kind.key !== "NOT_EMPLOYED"
}
export type AttendanceHrDirectory = {
  employees: Array<{ id: string; name: string; teamId: string | null; teamName: string | null }>
  catalogue: { items: AttendanceDayKind[]; version: string | null }
  timezone: string
}
