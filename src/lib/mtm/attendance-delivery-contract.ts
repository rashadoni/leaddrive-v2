import { z } from "zod"
import { AttendanceViewConfigSchema, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"
import { addDateKeyDays, currentDateKey, startOfIsoWeekDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUtc } from "@/lib/timezone"

export const AttendanceDeliveryInputSchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/),
  config: AttendanceViewConfigSchema,
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  format: z.enum(["xlsx", "pdf"]),
  locale: z.enum(["az", "ru", "en"]),
  recipients: z.array(z.string().trim().email().max(254).transform((value) => value.toLowerCase())).min(1).max(10)
    .refine((values) => new Set(values).size === values.length),
  enabled: z.boolean(),
}).strict().refine((value) => value.config.mode !== "MONTH" || value.frequency === "MONTHLY", { message: "Monthly grids require monthly delivery" })
export type AttendanceDeliveryInput = z.infer<typeof AttendanceDeliveryInputSchema>
export type AttendanceDeliveryFrequency = AttendanceDeliveryInput["frequency"]
export type AttendanceDeliverySchedule = AttendanceDeliveryInput & { id: string; timezone: string; nextRunAt: string; version: string }
export type AttendanceDeliveryReceipt = { id: string; scheduleId: string; recipient: string; from: string; to: string; status: "PENDING" | "SENDING" | "SENT" | "UNKNOWN" | "CANCELLED" | "FAILED"; createdAt: string; completedAt: string | null; errorCode: string | null }
const firstNextMonth = (date: string) => {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() + 1)
  return value.toISOString().slice(0, 10)
}

/** Operational default: 09:00 in the schedule's saved organization timezone. */
export function nextAttendanceDeliveryAt(frequency: AttendanceDeliveryFrequency, timezone: string, after: Date): Date {
  if (!isValidTimezone(timezone) || !Number.isFinite(after.getTime())) throw new Error("MTM_ATTENDANCE_DELIVERY_TIME_INVALID")
  const today = currentDateKey(after, timezone)
  let date = frequency === "MONTHLY" ? `${today.slice(0, 7)}-01` : frequency === "WEEKLY" ? startOfIsoWeekDateKey(today) : today
  let at = localDateTimeToUtc(`${date}T09:00`, timezone)
  if (at <= after) {
    date = frequency === "MONTHLY" ? firstNextMonth(date) : addDateKeyDays(date, frequency === "WEEKLY" ? 7 : 1)
    at = localDateTimeToUtc(`${date}T09:00`, timezone)
  }
  return at
}

/** After an outage send the latest complete period; never flood old periods. */
export function attendanceDeliveryConfig(config: AttendanceViewConfig, frequency: AttendanceDeliveryFrequency, timezone: string, now: Date): AttendanceViewConfig {
  const next = nextAttendanceDeliveryAt(frequency, timezone, now)
  const nextDate = currentDateKey(next, timezone)
  const dueDate = frequency === "MONTHLY" ? `${addDateKeyDays(nextDate, -1).slice(0, 7)}-01` : addDateKeyDays(nextDate, frequency === "WEEKLY" ? -7 : -1)
  const to = addDateKeyDays(dueDate, -1)
  const from = frequency === "DAILY" ? to : frequency === "WEEKLY" ? addDateKeyDays(dueDate, -7) : `${to.slice(0, 7)}-01`
  return AttendanceViewConfigSchema.parse({ ...config, filters: { ...config.filters, from, to } })
}
