import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
const date = z.string().refine(isDateKey)
const year = z.number().int().min(2000).max(2100)
const revision = { requestId: z.string().uuid(), expectedRevisionId: z.string().uuid().nullable(), year, reason: z.string().trim().min(3).max(1000) }
export const AttendanceLeavePolicySchema = z.object({
  basisDate: date.nullable(), counting: z.enum(["CALENDAR_EXCEPT_HOLIDAYS", "WORKING_DAYS"]).nullable(),
  minutesPerDay: z.number().int().min(1).max(1440).nullable(), reviewed: z.boolean(),
  tiers: z.array(z.object({ category: z.string().trim().min(1).max(80), minimumYears: z.number().int().min(0).max(80), days: z.number().min(0).max(366).multipleOf(0.5) }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  if (value.reviewed && (!value.basisDate || !value.counting || !value.tiers.length)) ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_LEAVE_POLICY_INCOMPLETE" })
  if (new Set(value.tiers.map(tier => `${tier.category}\u0000${tier.minimumYears}`)).size !== value.tiers.length) ctx.addIssue({ code: "custom", message: "MTM_ATTENDANCE_LEAVE_DUPLICATE_TIER" })
})
export const AttendanceLeavePolicyInputSchema = z.object({ ...revision, policy: AttendanceLeavePolicySchema }).strict().refine(value => !value.policy.basisDate || value.policy.basisDate.startsWith(`${value.year}-`))
export const AttendanceLeaveProfileSchema = z.object({ category: z.string().trim().min(1).max(80), serviceStart: date,
  openingDays: z.number().min(-3660).max(3660).multipleOf(0.5) }).strict()
export const AttendanceLeaveProfileInputSchema = z.object({ ...revision, agentId: z.string().min(1).max(191), profile: AttendanceLeaveProfileSchema }).strict()
export const AttendanceLeaveQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100), usedThrough: date.optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict()
export type AttendanceLeavePolicy = z.infer<typeof AttendanceLeavePolicySchema>
export type AttendanceLeaveProfile = z.infer<typeof AttendanceLeaveProfileSchema>
export type AttendanceLeaveRevision<T> = { id: string; year: number; version: number; createdAt: string; value: T }
export type AttendanceLeaveBalance = {
  employeeId: string; name: string; teamName: string | null; profile: AttendanceLeaveRevision<AttendanceLeaveProfile> | null
  serviceYears: number | null; allowanceDays: number | null; usedDays: number | null; plannedDays: number | null; remainingDays: number | null; availableDays: number | null
  state: "READY" | "POLICY_MISSING" | "PROFILE_MISSING" | "TENURE_UNKNOWN" | "TIER_MISSING" | "HOURS_UNCONFIGURED" | "HOURS_INVALID"
}
export type AttendanceLeaveDirectory = {
  year: number; usedThrough: string; today: string; canManage: boolean; hasMore: boolean
  policy: AttendanceLeaveRevision<AttendanceLeavePolicy> | null; rows: AttendanceLeaveBalance[]
}
