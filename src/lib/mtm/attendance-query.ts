import { z } from "zod"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { MTM_ATTENDANCE_REPORT_MAX_DAYS } from "@/lib/mtm/attendance-report"

export const AttendanceReportQuerySchema = z.object({
  from: z.string().refine(isDateKey),
  to: z.string().refine(isDateKey),
  employeeId: z.string().trim().min(1).max(191).optional(),
  teamId: z.string().trim().min(1).max(191).optional(),
  form: z.enum(["ALL", "LATE_EARLY", "ABSENCES", "JOURNAL"]).default("ALL"),
}).strict().refine((query) => isDateKey(query.from) && isDateKey(query.to)
  && query.to >= query.from && query.to < addDateKeyDays(query.from, MTM_ATTENDANCE_REPORT_MAX_DAYS))
export type AttendanceReportQuery = z.infer<typeof AttendanceReportQuerySchema>


export type AttendanceReportSnapshot = { id: string; asOf: string; query: AttendanceReportQuery }
