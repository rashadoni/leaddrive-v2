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

export const WORKFORCE_CALENDAR_CONFIGURATION_SCOPES = [
  "ORGANIZATION",
  "TEAM",
] as const

export const WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT = 100
export const WORKFORCE_CALENDAR_TEAM_QUERY_MAX_LENGTH = 100

const WorkforceCalendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isDateKey, "Date must be a real calendar date")

const WorkforceCalendarTeamIdSchema = z.string().trim().min(1).max(191)

export const WorkforceCalendarScopeSelectionSchema = z.object({
  scope: z.enum(WORKFORCE_CALENDAR_CONFIGURATION_SCOPES).default("ORGANIZATION"),
  teamId: WorkforceCalendarTeamIdSchema.optional(),
}).strict().superRefine((selection, context) => {
  if (selection.scope === "TEAM" && !selection.teamId) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Choose an active team" })
  }
  if (selection.scope === "ORGANIZATION" && selection.teamId !== undefined) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Organization scope cannot include a team" })
  }
})

export const WorkforceCalendarOverrideCreateSchema = z.object({
  scope: z.enum(WORKFORCE_CALENDAR_CONFIGURATION_SCOPES).default("ORGANIZATION"),
  teamId: WorkforceCalendarTeamIdSchema.optional(),
  date: WorkforceCalendarDateSchema,
  kind: z.enum(WORKFORCE_CALENDAR_CREATE_KINDS),
  name: z.string().trim().min(1).max(160),
}).strict().superRefine((draft, context) => {
  if (draft.scope === "TEAM" && !draft.teamId) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Choose an active team" })
  }
  if (draft.scope === "ORGANIZATION" && draft.teamId !== undefined) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Organization scope cannot include a team" })
  }
})

export type WorkforceCalendarCreateKind = (typeof WORKFORCE_CALENDAR_CREATE_KINDS)[number]
export type WorkforceCalendarReadKind = (typeof WORKFORCE_CALENDAR_READ_KINDS)[number]
export type WorkforceCalendarConfigurationScope = (typeof WORKFORCE_CALENDAR_CONFIGURATION_SCOPES)[number]
export type WorkforceCalendarScopeSelection = z.infer<typeof WorkforceCalendarScopeSelectionSchema>
export type WorkforceCalendarOverrideDraft = z.infer<typeof WorkforceCalendarOverrideCreateSchema>

export type WorkforceCalendarOverrideSummary = {
  date: string
  kind: WorkforceCalendarReadKind
  name: string | null
}

export type WorkforceCalendarTeamSummary = {
  id: string
  name: string
  code: string | null
  isActive: boolean
}
