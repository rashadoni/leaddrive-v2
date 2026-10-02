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
  "AGENT",
] as const

export const WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT = 100
export const WORKFORCE_CALENDAR_TEAM_QUERY_MAX_LENGTH = 100
export const WORKFORCE_CALENDAR_AGENT_SEARCH_LIMIT = 100
export const WORKFORCE_CALENDAR_AGENT_QUERY_MAX_LENGTH = 100

const WorkforceCalendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isDateKey, "Date must be a real calendar date")

const WorkforceCalendarTeamIdSchema = z.string().trim().min(1).max(191)
const WorkforceCalendarAgentIdSchema = z.string().trim().min(1).max(191)

function validateScopeSelection(
  selection: {
    scope: WorkforceCalendarConfigurationScope
    teamId?: string
    agentId?: string
  },
  context: z.RefinementCtx,
): void {
  if (selection.scope === "TEAM" && !selection.teamId) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Choose an active team" })
  }
  if (selection.scope === "AGENT" && !selection.agentId) {
    context.addIssue({ code: "custom", path: ["agentId"], message: "Choose an active employee" })
  }
  if (selection.scope !== "TEAM" && selection.teamId !== undefined) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Only team scope can include a team" })
  }
  if (selection.scope !== "AGENT" && selection.agentId !== undefined) {
    context.addIssue({ code: "custom", path: ["agentId"], message: "Only employee scope can include an employee" })
  }
}

export const WorkforceCalendarScopeSelectionSchema = z.object({
  scope: z.enum(WORKFORCE_CALENDAR_CONFIGURATION_SCOPES).default("ORGANIZATION"),
  teamId: WorkforceCalendarTeamIdSchema.optional(),
  agentId: WorkforceCalendarAgentIdSchema.optional(),
}).strict().superRefine(validateScopeSelection)

export const WorkforceCalendarOverrideCreateSchema = z.object({
  scope: z.enum(WORKFORCE_CALENDAR_CONFIGURATION_SCOPES).default("ORGANIZATION"),
  teamId: WorkforceCalendarTeamIdSchema.optional(),
  agentId: WorkforceCalendarAgentIdSchema.optional(),
  date: WorkforceCalendarDateSchema,
  kind: z.enum(WORKFORCE_CALENDAR_CREATE_KINDS),
  name: z.string().trim().min(1).max(160),
}).strict().superRefine(validateScopeSelection)

export const WorkforceCalendarMovedDayCreateSchema = z.object({
  operation: z.literal("MOVE_WORKDAY"),
  scope: z.enum(["ORGANIZATION", "TEAM"]),
  teamId: WorkforceCalendarTeamIdSchema.optional(),
  sourceDate: WorkforceCalendarDateSchema,
  destinationDate: WorkforceCalendarDateSchema,
  name: z.string().trim().min(1).max(160),
}).strict().superRefine((selection, context) => {
  if (selection.scope === "TEAM" && !selection.teamId) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Choose an active team" })
  }
  if (selection.scope === "ORGANIZATION" && selection.teamId !== undefined) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Only team scope can include a team" })
  }
  if (selection.sourceDate === selection.destinationDate) {
    context.addIssue({
      code: "custom",
      path: ["destinationDate"],
      message: "Choose two different calendar dates",
    })
  }
})

export const WorkforceCalendarMovedDayReverseSchema = z.object({
  operation: z.literal("REVERSE_MOVE_WORKDAY"),
  scope: z.enum(["ORGANIZATION", "TEAM"]),
  teamId: WorkforceCalendarTeamIdSchema.optional(),
  sourceDate: WorkforceCalendarDateSchema,
  destinationDate: WorkforceCalendarDateSchema,
  pairGenerationId: z.string().regex(/^[a-f0-9]{64}$/, "Choose an exact calendar pair generation"),
}).strict().superRefine((selection, context) => {
  if (selection.scope === "TEAM" && !selection.teamId) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Choose a team" })
  }
  if (selection.scope === "ORGANIZATION" && selection.teamId !== undefined) {
    context.addIssue({ code: "custom", path: ["teamId"], message: "Only team scope can include a team" })
  }
  if (selection.sourceDate === selection.destinationDate) {
    context.addIssue({ code: "custom", path: ["destinationDate"], message: "Choose two different calendar dates" })
  }
})

export const WorkforceCalendarConfigurationCreateSchema = z.union([
  WorkforceCalendarMovedDayReverseSchema,
  WorkforceCalendarMovedDayCreateSchema,
  WorkforceCalendarOverrideCreateSchema,
])

export type WorkforceCalendarCreateKind = (typeof WORKFORCE_CALENDAR_CREATE_KINDS)[number]
export type WorkforceCalendarReadKind = (typeof WORKFORCE_CALENDAR_READ_KINDS)[number]
export type WorkforceCalendarConfigurationScope = (typeof WORKFORCE_CALENDAR_CONFIGURATION_SCOPES)[number]
export type WorkforceCalendarScopeSelection = z.infer<typeof WorkforceCalendarScopeSelectionSchema>
export type WorkforceCalendarOverrideDraft = z.infer<typeof WorkforceCalendarOverrideCreateSchema>
export type WorkforceCalendarMovedDayDraft = z.infer<typeof WorkforceCalendarMovedDayCreateSchema>
export type WorkforceCalendarMovedDayReverseDraft = z.infer<typeof WorkforceCalendarMovedDayReverseSchema>
export type WorkforceCalendarConfigurationDraft = z.infer<typeof WorkforceCalendarConfigurationCreateSchema>

export type WorkforceCalendarOverrideSummary = {
  date: string
  kind: WorkforceCalendarReadKind
  name: string | null
  pairedDate: string | null
  /** Opaque generation of a complete reversible source pair; never a row ID. */
  pairGenerationId?: string
}

export type WorkforceCalendarTeamSummary = {
  id: string
  name: string
  code: string | null
  isActive: boolean
}

export type WorkforceCalendarAgentStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED"

export type WorkforceCalendarAgentSummary = {
  id: string
  name: string
  externalCode: string | null
  status: WorkforceCalendarAgentStatus
  currentTeam: WorkforceCalendarTeamSummary | null
}
