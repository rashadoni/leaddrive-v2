import type { PrismaClient } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"
import {
  parseWorkforceShiftDefinition,
  resolveWorkforceShiftDay,
  workforceShiftDefinitionHash,
  type WorkforceResolvedShift,
} from "@/lib/workforce/shift-definition"

export type WorkforceShiftTemplateCandidate = {
  id: string
  teamId: string | null
  isDefault: boolean
  version: number
  status: string
  timezone: string
  activatedAt: Date | null
  retiredAt: Date | null
  definition: unknown
  definitionHash: string
}

export type ResolvedWorkforceShiftTemplate = WorkforceShiftTemplateCandidate & {
  scope: "TEAM" | "ORGANIZATION"
  /** Null means that the selected template was an organization/team default. */
  assignmentId: string | null
  schedule: WorkforceResolvedShift | null
}

export class WorkforceShiftResolutionError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SHIFT_AGENT_NOT_FOUND"
      | "WORKFORCE_SHIFT_TEMPLATE_NOT_FOUND"
      | "WORKFORCE_SHIFT_WORKDATE_INVALID"
      | "WORKFORCE_SHIFT_RESOLUTION_TIME_INVALID"
      | "WORKFORCE_SHIFT_TEAM_MISMATCH"
      | "WORKFORCE_SHIFT_TEMPLATE_INACTIVE"
      | "WORKFORCE_SHIFT_TEMPLATE_HASH_MISMATCH"
      | "WORKFORCE_SHIFT_ASSIGNMENT_AMBIGUOUS",
    message: string = code,
  ) {
    super(message)
  }
}

function validInstant(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function validateResolutionWindow(input: {
  workDate: string
  workdayStartedAt: Date
  resolutionAt: Date
}): void {
  if (!isDateKey(input.workDate)) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_WORKDATE_INVALID",
      "Workforce shift workDate must be YYYY-MM-DD",
    )
  }
  if (!validInstant(input.workdayStartedAt)) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_WORKDATE_INVALID",
      "Workforce shift workday start is invalid",
    )
  }
  if (!validInstant(input.resolutionAt)) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_RESOLUTION_TIME_INVALID",
      "Workforce shift resolution time is invalid",
    )
  }
}

function isHistoricalOrganizationTemplate(
  template: WorkforceShiftTemplateCandidate,
  workdayStartedAt: Date,
): boolean {
  if ((template.status !== "ACTIVE" && template.status !== "RETIRED") || !validInstant(template.activatedAt)) {
    return false
  }
  if (workdayStartedAt.getTime() < template.activatedAt.getTime()) return false
  return template.status !== "RETIRED" || (
    validInstant(template.retiredAt) && workdayStartedAt.getTime() <= template.retiredAt.getTime()
  )
}

/**
 * Resolves an explicitly selected template. It intentionally does not choose
 * a default code: that selection remains a separate product contract.
 */
export function resolveWorkforceShiftTemplate(input: {
  workDate: string
  workdayStartedAt: Date
  resolutionAt: Date
  currentTeamId: string | null
  template: WorkforceShiftTemplateCandidate
  assignmentId?: string | null
}): ResolvedWorkforceShiftTemplate {
  validateResolutionWindow(input)

  const scope = input.template.teamId === null ? "ORGANIZATION" : "TEAM"
  if (scope === "TEAM") {
    if (input.template.teamId !== input.currentTeamId) {
      throw new WorkforceShiftResolutionError(
        "WORKFORCE_SHIFT_TEAM_MISMATCH",
        "Team-scoped Workforce shift must match the employee current team at server processing",
      )
    }
    if (
      input.template.status !== "ACTIVE"
      || !validInstant(input.template.activatedAt)
      || input.template.activatedAt.getTime() > input.resolutionAt.getTime()
    ) {
      throw new WorkforceShiftResolutionError(
        "WORKFORCE_SHIFT_TEMPLATE_INACTIVE",
        "Team-scoped Workforce shift must be active at server processing",
      )
    }
  } else if (!isHistoricalOrganizationTemplate(input.template, input.workdayStartedAt)) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_TEMPLATE_INACTIVE",
      "Organization Workforce shift must be active for the workday start",
    )
  }

  parseWorkforceShiftDefinition(input.template.definition)
  if (
    !/^[a-f0-9]{64}$/i.test(input.template.definitionHash)
    || workforceShiftDefinitionHash(input.template.definition) !== input.template.definitionHash.toLowerCase()
  ) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_TEMPLATE_HASH_MISMATCH",
      "Workforce shift definition does not match its immutable hash",
    )
  }

  return {
    ...input.template,
    scope,
    assignmentId: input.assignmentId ?? null,
    schedule: resolveWorkforceShiftDay({
      workDate: input.workDate,
      definition: input.template.definition,
      templateTimezone: input.template.timezone,
    }),
  }
}

type WorkforceShiftResolverDb = Pick<
  PrismaClient,
  "mtmAgent" | "workforceShiftAssignment" | "workforceShiftTemplate"
>

/**
 * Loads the employee's current team and resolves an effective-dated personal
 * assignment unless a caller explicitly selects a template; it otherwise
 * falls back to the active team/organization default. No active-agent filter
 * is applied: an already-started offline day must not change semantics merely
 * because the directory row was later deactivated.
 */
export async function resolveCurrentWorkforceShift(
  db: WorkforceShiftResolverDb,
  input: {
    organizationId: string
    agentId: string
    templateId?: string
    workDate: string
    workdayStartedAt: Date
    resolutionAt: Date
  },
): Promise<ResolvedWorkforceShiftTemplate> {
  validateResolutionWindow(input)
  const agent = await db.mtmAgent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId },
    select: { id: true, teamId: true },
  })
  if (!agent) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_AGENT_NOT_FOUND",
      "Workforce employee is unavailable",
    )
  }
  const templateSelect = {
    id: true,
    teamId: true,
    isDefault: true,
    version: true,
    status: true,
    timezone: true,
    activatedAt: true,
    retiredAt: true,
    definition: true,
    definitionHash: true,
  } as const
  const workDate = new Date(`${input.workDate}T00:00:00.000Z`)
  const assignments = input.templateId
    ? []
    : await db.workforceShiftAssignment.findMany({
        where: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          effectiveFrom: { lte: workDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
        },
        select: { id: true, templateId: true },
      })
  if (assignments.length > 1) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_ASSIGNMENT_AMBIGUOUS",
      "More than one Workforce shift assignment applies to this employee workday",
    )
  }
  const assignment = assignments[0] ?? null
  const templateId = input.templateId ?? assignment?.templateId
  const template = templateId
    ? await db.workforceShiftTemplate.findFirst({
        where: { id: templateId, organizationId: input.organizationId },
        select: templateSelect,
      })
    : await (async () => {
        const defaults = await db.workforceShiftTemplate.findMany({
          where: {
            organizationId: input.organizationId,
            status: "ACTIVE",
            isDefault: true,
            activatedAt: { lte: input.resolutionAt },
            OR: [{ teamId: null }, ...(agent.teamId ? [{ teamId: agent.teamId }] : [])],
          },
          select: templateSelect,
        })
        return defaults.find((candidate) => candidate.teamId === agent.teamId)
          ?? defaults.find((candidate) => candidate.teamId === null)
      })()
  if (!template) {
    throw new WorkforceShiftResolutionError(
      "WORKFORCE_SHIFT_TEMPLATE_NOT_FOUND",
      input.templateId
        ? "Workforce shift template is unavailable"
        : "No active default Workforce shift is configured for this employee",
    )
  }
  return resolveWorkforceShiftTemplate({
    workDate: input.workDate,
    workdayStartedAt: input.workdayStartedAt,
    resolutionAt: input.resolutionAt,
    currentTeamId: agent.teamId,
    template,
    assignmentId: assignment?.id ?? null,
  })
}
