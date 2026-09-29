import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"

export const WORKFORCE_CALENDAR_CREATE_KINDS = [
  "PUBLIC_HOLIDAY",
  "COMPANY_HOLIDAY",
  "EXCEPTION_WORKDAY",
] as const

export const WORKFORCE_CALENDAR_READ_KINDS = [
  "WORKING_DAY",
  "WEEKEND",
  ...WORKFORCE_CALENDAR_CREATE_KINDS,
  "MOVED_WORKDAY",
  "MOVED_DAY_OFF",
] as const

const WorkforceCalendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isDateKey, "Date must be a real calendar date")

export const WorkforceCalendarOverrideCreateSchema = z.object({
  date: WorkforceCalendarDateSchema,
  kind: z.enum(WORKFORCE_CALENDAR_CREATE_KINDS),
  name: z.string().trim().min(1).max(160),
}).strict()

export type WorkforceCalendarCreateKind = (typeof WORKFORCE_CALENDAR_CREATE_KINDS)[number]
export type WorkforceCalendarReadKind = (typeof WORKFORCE_CALENDAR_READ_KINDS)[number]
export type WorkforceCalendarOverrideDraft = z.infer<typeof WorkforceCalendarOverrideCreateSchema>

export type WorkforceCalendarOverrideSummary = {
  date: string
  kind: WorkforceCalendarReadKind
  name: string | null
}
