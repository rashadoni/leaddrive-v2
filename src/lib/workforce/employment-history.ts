import { Prisma, type PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { resolveWorkforceHistoricalTeamMembership, type WorkforceHistoricalTeamMembership } from "@/lib/workforce/team-membership"
import { prisma } from "@/lib/prisma"
import type { WorkforceConfigurationAuditContext } from "@/lib/workforce/configuration-management"

const IdentifierSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,191}$/)
const EffectiveInstantSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value))

export const WorkforceEmploymentEventCreateSchema = z.object({
  agentId: IdentifierSchema,
  kind: z.enum(["HIRE", "TERMINATION", "REHIRE"]),
  effectiveAt: EffectiveInstantSchema,
}).strict()

export type WorkforceEmploymentState = "UNKNOWN" | "EMPLOYED" | "TERMINATED"

export type WorkforceEmploymentHistoryEvent = {
  id: string
  kind: "HIRE" | "TERMINATION" | "REHIRE"
  effectiveAt: Date
  source: string
  recordedAt: Date
}

export type WorkforceHistoricalAssignment = {
  employment: {
    state: WorkforceEmploymentState
    event: Pick<WorkforceEmploymentHistoryEvent, "id" | "kind" | "effectiveAt"> | null
  }
  teamMembership: WorkforceHistoricalTeamMembership | null
  siteAssignments: Array<{
    id: string
    siteId: string
    kind: "PRIMARY" | "SECONDARY" | "TEMPORARY"
    effectiveFrom: Date
    effectiveTo: Date | null
  }>
}

export class WorkforceEmploymentHistoryError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_EMPLOYMENT_AGENT_NOT_FOUND"
      | "WORKFORCE_EMPLOYMENT_EVENT_ORDER_INVALID"
      | "WORKFORCE_EMPLOYMENT_EVENT_TRANSITION_INVALID",
    message: string = code,
  ) {
    super(message)
  }
}

type WorkforceEmploymentHistoryLookupDb = Pick<PrismaClient, "$queryRaw">
type EmploymentHistoryDb = WorkforceEmploymentHistoryLookupDb & Pick<PrismaClient, "workforceSiteAssignment">

function validInstant(value: Date): boolean {
  return Number.isFinite(value.getTime())
}

function dateKeyAsUtcDate(value: string): Date {
  if (!isDateKey(value)) throw new Error("Workforce historical assignment work date is invalid")
  return new Date(value + "T00:00:00.000Z")
}

function stateForEvent(kind: WorkforceEmploymentHistoryEvent["kind"] | null): WorkforceEmploymentState {
  if (kind === "HIRE" || kind === "REHIRE") return "EMPLOYED"
  if (kind === "TERMINATION") return "TERMINATED"
  return "UNKNOWN"
}

/**
 * Reads only the explicit lifecycle fact effective at an instant. It must not
 * infer employment from a mutable directory status, current team or site
 * assignment. A missing fact is intentionally `UNKNOWN`, which lets callers
 * fail closed rather than classify an inactive or migrated record as absent.
 */
export async function resolveWorkforceHistoricalEmployment(
  db: WorkforceEmploymentHistoryLookupDb,
  input: { organizationId: string; agentId: string; occurredAt: Date },
): Promise<WorkforceHistoricalAssignment["employment"] | null> {
  if (!validInstant(input.occurredAt)) throw new Error("Workforce historical employment instant is invalid")
  const rows = await db.$queryRaw<Array<{
    agentId: string | null
    eventId: string | null
    kind: "HIRE" | "TERMINATION" | "REHIRE" | null
    effectiveAt: Date | null
  }>>(Prisma.sql`
    SELECT agent."id" AS "agentId", event."id" AS "eventId", event."kind", event."effectiveAt"
    FROM "mtm_agents" AS agent
    LEFT JOIN LATERAL (
      SELECT "id", "kind", "effectiveAt"
      FROM "workforce_employment_events"
      WHERE "organizationId" = ${input.organizationId}
        AND "agentId" = ${input.agentId}
        AND "effectiveAt" <= ${input.occurredAt}
      ORDER BY "effectiveAt" DESC, "id" DESC
      LIMIT 1
    ) AS event ON TRUE
    WHERE agent."organizationId" = ${input.organizationId}
      AND agent."id" = ${input.agentId}
    FOR SHARE OF agent
  `)
  const row = rows[0]
  if (!row?.agentId) return null
  const event = row.eventId && row.kind && row.effectiveAt && validInstant(row.effectiveAt)
    ? { id: row.eventId, kind: row.kind, effectiveAt: row.effectiveAt }
    : null
  return {
    state: stateForEvent(event?.kind ?? null),
    event,
  }
}

/**
 * Resolves only explicit HR lifecycle, immutable team membership and
 * effective-dated Workforce-site facts. It deliberately has no fallback to a
 * mutable employee status/current team or to Route data when an old claim
 * reaches the server later.
 */
export async function resolveWorkforceHistoricalAssignment(
  db: EmploymentHistoryDb,
  input: { organizationId: string; agentId: string; occurredAt: Date; workDate: string },
): Promise<WorkforceHistoricalAssignment | null> {
  if (!validInstant(input.occurredAt)) throw new Error("Workforce historical assignment instant is invalid")
  const workDate = dateKeyAsUtcDate(input.workDate)
  const employment = await resolveWorkforceHistoricalEmployment(db, input)
  if (!employment) return null

  const [teamMembership, siteAssignments] = await Promise.all([
    resolveWorkforceHistoricalTeamMembership(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      workdayStartedAt: input.occurredAt,
    }),
    db.workforceSiteAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      orderBy: [{ kind: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }],
      select: { id: true, siteId: true, kind: true, effectiveFrom: true, effectiveTo: true },
    }),
  ])
  return {
    employment,
    teamMembership,
    siteAssignments,
  }
}

type RecordEmploymentHistoryContext = {
  organizationId: string
  recordedByUserId: string
  event: z.infer<typeof WorkforceEmploymentEventCreateSchema>
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}

/**
 * Appends a named HR lifecycle fact. It never changes `MtmAgent.status`, a
 * team assignment or a site assignment; those retain their separate,
 * effective-dated contracts. Backdating/reordering is intentionally refused:
 * a correction workflow must be designed explicitly before historical facts
 * can be inserted ahead of already recorded lifecycle events.
 */
export async function recordWorkforceEmploymentEvent(
  input: RecordEmploymentHistoryContext,
): Promise<WorkforceEmploymentHistoryEvent> {
  const db = input.db ?? prisma
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"workforce-employment:" + input.organizationId + ":" + input.event.agentId}))`
    const agent = await tx.mtmAgent.findFirst({
      where: { organizationId: input.organizationId, id: input.event.agentId },
      select: { id: true },
    })
    if (!agent) {
      throw new WorkforceEmploymentHistoryError(
        "WORKFORCE_EMPLOYMENT_AGENT_NOT_FOUND",
        "The Workforce employee is not available in this tenant",
      )
    }
    const [previous] = await tx.$queryRaw<Array<{
      id: string
      kind: WorkforceEmploymentHistoryEvent["kind"]
      effectiveAt: Date
    }>>(Prisma.sql`
      SELECT "id", "kind", "effectiveAt"
      FROM "workforce_employment_events"
      WHERE "organizationId" = ${input.organizationId}
        AND "agentId" = ${input.event.agentId}
      ORDER BY "effectiveAt" DESC, "id" DESC
      LIMIT 1
      FOR UPDATE
    `)
    if (previous && input.event.effectiveAt.getTime() <= previous.effectiveAt.getTime()) {
      throw new WorkforceEmploymentHistoryError(
        "WORKFORCE_EMPLOYMENT_EVENT_ORDER_INVALID",
        "An employment event must be effective after the last recorded lifecycle event",
      )
    }
    const previousKind = previous?.kind as WorkforceEmploymentHistoryEvent["kind"] | undefined
    const previousState = stateForEvent(previousKind ?? null)
    const expected = input.event.kind === "HIRE"
      ? previous == null
      : input.event.kind === "TERMINATION"
        ? previousState === "EMPLOYED"
        : previousState === "TERMINATED"
    if (!expected) {
      throw new WorkforceEmploymentHistoryError(
        "WORKFORCE_EMPLOYMENT_EVENT_TRANSITION_INVALID",
        "The requested employment lifecycle transition is not valid after the last recorded event",
      )
    }
    const [event] = await tx.$queryRaw<Array<WorkforceEmploymentHistoryEvent>>(Prisma.sql`
      INSERT INTO "workforce_employment_events" (
        "id", "organizationId", "agentId", "kind", "effectiveAt", "source", "recordedByUserId"
      ) VALUES (
        ${randomUUID()}, ${input.organizationId}, ${input.event.agentId},
        ${input.event.kind}::"WorkforceEmploymentEventKind", ${input.event.effectiveAt},
        'HR_RECORDED', ${input.recordedByUserId}
      )
      RETURNING "id", "kind", "effectiveAt", "source", "recordedAt"
    `)
    if (!event) throw new Error("Workforce employment event insert returned no row")
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.event.agentId,
        action: "WORKFORCE_EMPLOYMENT_EVENT_RECORDED",
        entity: "workforce_employment_event",
        entityId: event.id,
        metadataKind: "workforce_employment_history",
        newData: {
          kind: event.kind,
          effectiveAt: event.effectiveAt.toISOString(),
          source: event.source,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
    return event
  })
}
