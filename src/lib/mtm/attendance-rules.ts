import { z } from "zod"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

export interface MtmAttendanceRule {
  id: string
  effectiveFrom: string
  timezone: string
  startTime: string
  endTime: string
  lunchMinutes: number
  /** When lunch starts (HH:MM); unknown on rules saved before 2026-10-16. */
  lunchStart?: string | null
  lateGraceMinutes: number
  weekendDays: number[]
  createdAt: string | null
  createdBy: string | null
}

/** Frozen baseline, including its timezone: live settings cannot rewrite history. */
export const MTM_ATTENDANCE_BASELINE_RULE: MtmAttendanceRule = {
  id: "mtm-default-v1", effectiveFrom: "0001-01-01", timezone: "Asia/Baku",
  startTime: "09:00", endTime: "18:00", lunchMinutes: 60, lateGraceMinutes: 10,
  weekendDays: [0, 6], createdAt: null, createdBy: null,
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const AttendanceRuleInputSchema = z.object({
  effectiveFrom: z.string().refine(isDateKey),
  startTime: time,
  endTime: time,
  lunchMinutes: z.number().int().min(0).max(1439),
  // Optional: a tab opened before 2026-10-16 sends the length alone.
  lunchStart: time.nullable().optional(),
  lateGraceMinutes: z.number().int().min(0).max(120),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(6)
    .refine((days) => new Set(days).size === days.length),
}).strict().refine((rule) => minutesOfDay(rule.endTime) - minutesOfDay(rule.startTime) > rule.lunchMinutes)
  // The lunch lies inside the working day.
  .refine((rule) => !rule.lunchStart || (rule.lunchMinutes > 0 && minutesOfDay(rule.lunchStart) >= minutesOfDay(rule.startTime)
    && minutesOfDay(rule.lunchStart) + rule.lunchMinutes <= minutesOfDay(rule.endTime)))
export type AttendanceRuleInput = z.infer<typeof AttendanceRuleInputSchema>

export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number)
  return hours * 60 + minutes
}

export function attendanceRuleForDate(versions: readonly MtmAttendanceRule[], date: string): MtmAttendanceRule {
  if (!isDateKey(date)) throw new Error("MTM_ATTENDANCE_DATE_INVALID")
  return versions.reduce((current, candidate) => (
    candidate.effectiveFrom <= date && candidate.effectiveFrom > current.effectiveFrom ? candidate : current
  ), MTM_ATTENDANCE_BASELINE_RULE)
}

/** Also considers old timezones: a timezone edit cannot make an old day future. */
export function attendanceRuleMinimumDate(versions: readonly MtmAttendanceRule[], timezone: string, now = new Date()): string {
  if (!isValidTimezone(timezone)) throw new Error("MTM_ATTENDANCE_TIMEZONE_INVALID")
  const dates = [timezone, MTM_ATTENDANCE_BASELINE_RULE.timezone, ...versions.map((rule) => rule.timezone)]
    .map((zone) => currentDateKey(now, zone))
  dates.push(...versions.map((rule) => rule.effectiveFrom))
  return addDateKeyDays(dates.sort().at(-1)!, 1)
}
