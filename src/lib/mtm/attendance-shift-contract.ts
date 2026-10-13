import { z } from "zod"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { minutesOfDay } from "@/lib/mtm/attendance-rules"
import { isValidTimezone } from "@/lib/timezone"
const date = z.string().refine(isDateKey)
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const AttendanceShiftDaySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("OFF") }).strict(),
  z.object({ kind: z.literal("WORK"), startTime: clock, endTime: clock, nextDay: z.boolean(),
    lunchMinutes: z.number().int().min(0).max(1439), lateGraceMinutes: z.number().int().min(0).max(120) }).strict(),
]).superRefine((day, ctx) => {
  if (day.kind === "OFF") return
  const duration = minutesOfDay(day.endTime) + (day.nextDay ? 1440 : 0) - minutesOfDay(day.startTime)
  if (duration <= day.lunchMinutes || duration > 1440) ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_SHIFT_CLOCK_INVALID" })
})
export const AttendanceShiftValueSchema = z.object({
  from: date, to: date, timezone: z.string().refine(isValidTimezone),
  attribution: z.enum(["START_DAY", "END_DAY"]), cycle: z.array(AttendanceShiftDaySchema).min(1).max(28),
  preHolidayMinutes: z.number().int().min(0).max(240).nullable(), preHolidayConfirmed: z.boolean(),
  overtimeThresholdMinutes: z.number().int().min(0).max(1440).nullable(),
}).strict().superRefine((value, ctx) => {
  if (!isDateKey(value.from) || !isDateKey(value.to) || value.to < value.from || value.to >= addDateKeyDays(value.from, 93)) ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_SHIFT_RANGE_INVALID" })
  if (value.preHolidayMinutes !== null && !value.preHolidayConfirmed) ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_SHIFT_NORM_UNCONFIRMED" })
  if (value.preHolidayMinutes !== null && value.cycle.some(day => day.kind === "WORK" && minutesOfDay(day.endTime) + (day.nextDay ? 1440 : 0) - minutesOfDay(day.startTime) - day.lunchMinutes <= value.preHolidayMinutes!)) ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_SHIFT_SHORTENING_INVALID" })
})
export const AttendanceShiftPublishSchema = z.object({ requestId: z.string().uuid(), expectedRevisionId: z.string().uuid().nullable(),
  expectedRosterHash: z.string().regex(/^[a-f0-9]{64}$/), teamId: z.string().min(1).max(191).nullable(),
  reason: z.string().trim().min(3).max(1000), value: AttendanceShiftValueSchema }).strict()
export const AttendanceShiftQuerySchema = z.object({ from: date, to: date }).strict().refine(value => isDateKey(value.from) && isDateKey(value.to) && value.to >= value.from && value.to < addDateKeyDays(value.from, 366))
export type AttendanceShiftValue = z.infer<typeof AttendanceShiftValueSchema>
export type AttendanceShiftPlan = { id: string; version: number; createdAt: string; teamId: string | null; teamName: string | null; memberCount: number; value: AttendanceShiftValue }
export type AttendanceShiftAssignment = { agentId: string; plan: AttendanceShiftPlan }
export type AttendanceShiftRoster = { teamId: string | null; name: string | null; count: number; hash: string }
export type AttendanceShiftDirectory = { plans: AttendanceShiftPlan[]; revisionId: string | null; canManage: boolean; today: string; timezone: string; rosters: AttendanceShiftRoster[] }
