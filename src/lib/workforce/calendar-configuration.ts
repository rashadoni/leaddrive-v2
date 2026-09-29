import { Prisma, type PrismaClient } from "@prisma/client"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { resolveWorkCalendarDay } from "@/lib/mtm/work-calendar"
import { prisma } from "@/lib/prisma"
import type { WorkforceConfigurationAuditContext } from "@/lib/workforce/configuration-management"
import {
  type WorkforceCalendarOverrideDraft,
  type WorkforceCalendarOverrideSummary,
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

export class WorkforceCalendarConfigurationError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_CALENDAR_CONFIGURATION_DATE_RANGE_INVALID"
      | "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE"
      | "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
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

export async function listWorkforceCalendarOverrides(input: {
  organizationId: string
  currentDate: string
  start: string
  endExclusive: string
  db?: PrismaClient
}): Promise<WorkforceCalendarOverrideSummary[]> {
  assertFutureRange(input)
  const db = input.db ?? prisma
  const rows = await db.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: input.organizationId,
      date: {
        gte: asDatabaseDate(input.start),
        lt: asDatabaseDate(input.endExclusive),
      },
      teamId: null,
      agentId: null,
      deletedAt: null,
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: calendarSummarySelect,
  })
  return rows.map(calendarSummary)
}

/**
 * Adds one organization-wide future exception to the retained calendar
 * ledger. The operation is state-idempotent: an exact existing state is a
 * safe retry; a different state for the same tenant/date is a conflict.
 */
export async function createWorkforceCalendarOverride(input: {
  organizationId: string
  createdByUserId: string
  currentDate: string
  draft: WorkforceCalendarOverrideDraft
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}): Promise<{ day: WorkforceCalendarOverrideSummary; created: boolean }> {
  if (!isDateKey(input.currentDate) || input.draft.date <= input.currentDate) {
    throw new WorkforceCalendarConfigurationError(
      "WORKFORCE_CALENDAR_CONFIGURATION_DATE_NOT_FUTURE",
      "Calendar overrides must start after the organization's current date",
    )
  }
  const db = input.db ?? prisma
  const routePlanningAllowed = resolveWorkCalendarDay({
    date: input.draft.date,
    overrides: [],
  }).routePlanningAllowed

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-calendar-configuration:${input.organizationId}:${input.draft.date}`}))`
      const existing = await tx.mtmWorkCalendarDay.findFirst({
        where: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.date),
          teamId: null,
          agentId: null,
          deletedAt: null,
        },
        select: calendarExistingSelect,
      })
      if (existing) {
        const exactState = existing.kind === input.draft.kind
          && existing.name === input.draft.name
          && existing.teamId == null
          && existing.agentId == null
          && existing.movedToDate == null
          && existing.routePlanningAllowed === routePlanningAllowed
          && existing.source === "ADMIN"
        if (exactState) {
          return { day: calendarSummary(existing), created: false }
        }
        throw new WorkforceCalendarConfigurationError(
          "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
          "A different organization calendar override already exists for this date",
        )
      }

      const created = await tx.mtmWorkCalendarDay.create({
        data: {
          organizationId: input.organizationId,
          date: asDatabaseDate(input.draft.date),
          kind: input.draft.kind,
          name: input.draft.name,
          teamId: null,
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
            scope: "ORGANIZATION",
            source: "ADMIN",
            routePlanningBaseline: routePlanningAllowed,
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return { day: calendarSummary(created), created: true }
    })
  } catch (error) {
    if (error instanceof WorkforceCalendarConfigurationError) throw error
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceCalendarConfigurationError(
        "WORKFORCE_CALENDAR_CONFIGURATION_OVERRIDE_EXISTS",
        "A concurrent organization calendar override already exists for this date",
      )
    }
    throw error
  }
}
