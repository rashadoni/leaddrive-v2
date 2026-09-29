import { Prisma, type PrismaClient } from "@prisma/client"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { resolveWorkCalendarDay } from "@/lib/mtm/work-calendar"
import { prisma } from "@/lib/prisma"
import type { WorkforceConfigurationAuditContext } from "@/lib/workforce/configuration-management"
import {
  WORKFORCE_CALENDAR_TEAM_QUERY_MAX_LENGTH,
  WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT,
  type WorkforceCalendarConfigurationScope,
  type WorkforceCalendarOverrideDraft,
  type WorkforceCalendarOverrideSummary,
  type WorkforceCalendarTeamSummary,
} from "@/lib/workforce/calendar-configuration-contract"

const calendarSummarySelect = {
  date: true,
  kind: true,
  name: true,
} satisfies Prisma.MtmWorkCalendarDaySelect

const calendarExistingSelect = {
  id: true,
  date: true,
  kind: true,
  name: true,
  teamId: true,
  agentId: true,
  movedToDate: true,
  routePlanningAllowed: true,
  source: true,
} satisfies Prisma.MtmWorkCalendarDaySelect

const calendarTeamSelect = {
  id: true,
  name: true,
  code: true,
  isActive: true,
} satisfies Prisma.MtmTeamSelect

export class WorkforceCalendarConfigurationError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE"
      | "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS"
      | "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE"
      | "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_SEARCH_INVALID",
    message: string = code,
  ) {
    super(message)
  }
}

function asDatabaseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function calendarSummary(row: {
  date: Date
  kind: string
  name: string | null
}): WorkforceCalendarOverrideSummary {
  return {
    date: dateKey(row.date),
    kind: row.kind as WorkforceCalendarOverrideSummary["kind"],
    name: row.name,
  }
}

function assertFutureRange(input: {
  currentDate: string
  start: string
  endExclusive: string
}): void {
  if (
    !isDateKey(input.currentDate)
    || !isDateKey(input.start)
    || !isDateKey(input.endExclusive)
    || input.start <= input.currentDate
    || input.endExclusive <= input.start
    || input.endExclusive > addDateKeyDays(input.start, 367)
  ) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID",
      "Choose a future calendar range of 1 to 367 days",
    )
  }
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code
}

function teamIdForScope(input: {
  scope: WorkforceCalendarConfigurationScope
  teamId?: string
}): string | null {
  if (input.scope === "TEAM") {
    if (input.teamId) return input.teamId
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID",
      "Choose one supported calendar scope",
    )
  }
  if (input.teamId !== undefined) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_SCOPE_INVALID",
      "Choose one supported calendar scope",
    )
  }
  return null
}

export async function searchWorkforceCalendarTeams(input: {
  organizationId: string
  query: string
  limit?: number
  selectedTeamId?: string
  db?: PrismaClient
}): Promise<{
  teams: WorkforceCalendarTeamSummary[]
  selectedTeam: WorkforceCalendarTeamSummary | null
  query: string
  limit: number
  hasMore: boolean
}> {
  const query = input.query.trim()
  const limit = input.limit ?? WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT
  if (
    query.length > WORKFORCE_CALENDAR_TEAM_QUERY_MAX_LENGTH
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > WORKFORCE_CALENDAR_TEAM_SEARCH_LIMIT
  ) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_SEARCH_INVALID",
      "Choose a valid bounded team search",
    )
  }
  const db = input.db ?? prisma
  const [matches, selectedTeam] = await Promise.all([
    db.mtmTeam.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { code: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: calendarTeamSelect,
    }),
    input.selectedTeamId
      ? db.mtmTeam.findFirst({
          where: { organizationId: input.organizationId, id: input.selectedTeamId },
          select: calendarTeamSelect,
        })
      : Promise.resolve(null),
  ])
  return {
    teams: matches.slice(0, limit),
    selectedTeam,
    query,
    limit,
    hasMore: matches.length > limit,
  }
}

export async function listWorkforceCalendarOverrides(input: {
  organizationId: string
  currentDate: string
  start: string
  endExclusive: string
  scope: WorkforceCalendarConfigurationScope
  teamId?: string
  db?: PrismaClient
}): Promise<WorkforceCalendarOverrideSummary[]> {
  assertFutureRange(input)
  const teamId = teamIdForScope(input)
  const db = input.db ?? prisma
  const rows = await db.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: input.organizationId,
      date: {
        gte: asDatabaseDate(input.start),
        lt: asDatabaseDate(input.endExclusive),
      },
      teamId,
      agentId: null,
      deletedAt: null,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: calendarSummarySelect,
  })
  return rows.map(calendarSummary)
}

/**
 * Adds one organization/team future exception to the retained calendar
 * ledger. The operation is state-idempotent: an exact existing state is a
 * safe retry; a different state for the same tenant/date/scope is a conflict.
 */
export async function createWorkforceCalendarOverride(input: {
  organizationId: string
  createdByUserId: string
  currentDate: string
  draft: WorkforceCalendarOverrideDraft
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}): Promise<{
  day: WorkforceCalendarOverrideSummary
  team: WorkforceCalendarTeamSummary | null
  created: boolean
}> {
  if (!isDateKey(input.currentDate) || input.draft.date <= input.currentDate) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE",
      "Calendar overrides must start after the organization's current date",
    )
  }
  const expectedTeamId = teamIdForScope(input.draft)
  const db = input.db ?? prisma

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-calendar-configuration:${input.organizationId}:${input.draft.date}`}))`
      const team = input.draft.scope === "TEAM"
        ? await tx.mtmTeam.findFirst({
            where: {
              organizationId: input.organizationId,
              id: expectedTeamId as string,
              isActive: true,
            },
            select: calendarTeamSelect,
          })
        : null
      if (input.draft.scope === "TEAM" && !team) {
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_TEAM_UNAVAILABLE",
          "The selected active team is unavailable",
        )
      }

      const candidates = await tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.date),
          agentId: null,
          deletedAt: null,
          OR: input.draft.scope === "TEAM"
            ? [{ teamId: expectedTeamId }, { teamId: null }]
            : [{ teamId: null }],
        },
        orderBy: [{ teamId: "asc" }, { id: "asc" }],
        select: calendarExistingSelect,
      })
      const existing = candidates.find((candidate) => candidate.teamId === expectedTeamId)
      const routePlanningAllowed = resolveWorkCalendarDay({
        date: input.draft.date,
        // An organization row is the state being validated, not its own
        // baseline. Only a team override inherits a pre-existing organization
        // decision for the same date.
        overrides: input.draft.scope === "TEAM"
          ? candidates.filter((candidate) => candidate.teamId === null)
          : [],
        teamId: expectedTeamId,
      }).routePlanningAllowed
      if (existing) {
        const exactState = existing.kind === input.draft.kind
          && existing.name === input.draft.name
          && existing.teamId === expectedTeamId
          && existing.agentId == null
          && existing.movedToDate == null
          && existing.routePlanningAllowed === routePlanningAllowed
          && existing.source === "ADMIN"
        if (exactState) {
          return { day: calendarSummary(existing), team, created: false }
        }
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
          "A different calendar override already exists for this date and scope",
        )
      }

      const created = await tx.mtmWorkCalendarDay.create({
        data: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.date),
          kind: input.draft.kind,
          name: input.draft.name,
          teamId: expectedTeamId,
          agentId: null,
          movedToDate: null,
          routePlanningAllowed,
          source: "ADMIN",
          createdBy: input.createdByUserId,
          updatedBy: input.createdByUserId,
        },
        select: calendarExistingSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          actorUserId: input.audit.actorUserId,
          action: "WORKFORCE_CALENDAR_OVERRIDE_CREATED",
          entity: "work_calendar_day",
          entityId: created.id,
          metadataKind: "workforce_calendar_configuration",
          newData: {
            actorUserId: input.audit.actorUserId,
            date: input.draft.date,
            kind: input.draft.kind,
            name: input.draft.name,
            scope: input.draft.scope,
            teamId: team?.id ?? null,
            teamName: team?.name ?? null,
            teamCode: team?.code ?? null,
            source: "ADMIN",
            routePlanningBaseline: routePlanningAllowed,
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return { day: calendarSummary(created), team, created: true }
    })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) throw error
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
        "A concurrent calendar override already exists for this date and scope",
      )
    }
    throw error
  }
}
