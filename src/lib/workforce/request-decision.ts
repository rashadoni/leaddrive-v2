import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import {
  isAgentInWorkforceScope,
  type WorkforceActor,
} from "@/lib/workforce/actor"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
  WorkforceWorkdayFactsReplayError,
} from "@/lib/workforce/workday-facts-replay"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"

export const WorkforceRequestDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional().nullable(),
  acknowledgeRouteConflicts: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.decision === "REJECTED" && !value.note) {
    ctx.addIssue({ code: "custom", path: ["note"], message: "A rejection reason is required" })
  }
})

export type WorkforceRequestDecisionInput = z.infer<typeof WorkforceRequestDecisionSchema>

export type WorkforceRouteConflict = {
  id: string
  name: string | null
  date: Date
  status: string
  totalPoints: number
}

type WorkforceDecisionContext = {
  organizationId: string
  userId: string
  actor: WorkforceActor
  requestId: string
  input: WorkforceRequestDecisionInput
  /**
   * The legacy Route & Field adapter opts into this read. The independent
   * Workforce route keeps it off until Route & Field is separately enabled,
   * so an HRM-only decision never depends on route data or a route service.
   */
  includeRouteConflicts: boolean
  req?: NextRequest
}

type DecisionData = {
  id: string
  status: string
  decisionNote: string | null
  decidedAt: Date | null
  updatedAt: Date
}

export type WorkforceDecisionResult =
  | { kind: "success"; data: DecisionData; conflicts: WorkforceRouteConflict[]; idempotent: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "already_decided"; status: string }
  | { kind: "route_conflict"; conflicts: WorkforceRouteConflict[] }
  | { kind: "conflict"; message: string; code: string }

class DecisionConflict extends Error {
  constructor(message: string, readonly code = "WORKFORCE_DECISION_CONFLICT") {
    super(message)
  }
}

function dateKeys(start: Date, end: Date): string[] {
  const first = start.toISOString().slice(0, 10)
  const last = end.toISOString().slice(0, 10)
  const result: string[] = []
  for (let date = first; date <= last; date = addDateKeyDays(date, 1)) result.push(date)
  return result
}

function decisionData(request: {
  id: string
  status: string
  decisionNote: string | null
  decidedAt: Date | null
  updatedAt: Date
}): DecisionData {
  return {
    id: request.id,
    status: request.status,
    decisionNote: request.decisionNote,
    decidedAt: request.decidedAt,
    updatedAt: request.updatedAt,
  }
}

function pausedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000))
}

/**
 * Applies one manager decision to a pending HRM request.
 *
 * The request status transition, immutable workday correction ledger facts,
 * availability calendar facts and employee notifications live in one database
 * transaction. Route conflicts are read-only preflight data: a route consumer
 * failure can neither roll back nor silently delete an approved HRM fact.
 */
export async function decideWorkforceRequest(context: WorkforceDecisionContext): Promise<WorkforceDecisionResult> {
  const { organizationId, userId, actor, requestId, input, includeRouteConflicts, req } = context
  if (actor.role === "AGENT") return { kind: "forbidden" }

  const request = await prisma.mtmHrmRequest.findFirst({
    where: { id: requestId, organizationId },
    select: {
      id: true,
      agentId: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      correctionWorkdayId: true,
      requestedStartAt: true,
      requestedEndAt: true,
      reason: true,
      decisionNote: true,
      decidedAt: true,
      updatedAt: true,
    },
  })
  if (!request) return { kind: "not_found" }
  if (!isAgentInWorkforceScope(actor, request.agentId)) return { kind: "forbidden" }

  // Existing clients did not send a decision operationId. Treat a repeat of
  // the same terminal decision as a safe replay; a different terminal result
  // remains an explicit conflict rather than changing approved history.
  if (request.status !== "PENDING") {
    if (request.status === input.decision) {
      return { kind: "success", data: decisionData(request), conflicts: [], idempotent: true }
    }
    return { kind: "already_decided", status: request.status }
  }

  const affectsAvailability = input.decision === "APPROVED"
    && (request.type === "LEAVE" || request.type === "ABSENCE")
  const conflictingRoutes: WorkforceRouteConflict[] = includeRouteConflicts && affectsAvailability
    ? await prisma.mtmRoute.findMany({
        where: {
          organizationId,
          AND: [{
            OR: [
              { agentId: request.agentId },
              { assignments: { some: { agentId: request.agentId, removedAt: null } } },
            ],
          }],
          date: { gte: request.startDate, lte: request.endDate },
          status: { in: ["PLANNED", "IN_PROGRESS"] },
          deletedAt: null,
        },
        orderBy: { date: "asc" },
        take: 50,
        select: { id: true, name: true, date: true, status: true, totalPoints: true },
      })
    : []
  if (conflictingRoutes.length > 0 && !input.acknowledgeRouteConflicts) {
    return { kind: "route_conflict", conflicts: conflictingRoutes }
  }

  const decidedAt = new Date()
  let data: DecisionData
  try {
    const updatedRequest = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.mtmHrmRequest.updateMany({
        where: { id: request.id, organizationId, status: "PENDING" },
        data: {
          status: input.decision,
          decisionNote: input.note || null,
          decidedByUserId: userId,
          decidedAt,
        },
      })
      if (updated.count !== 1) throw new DecisionConflict("Request changed concurrently")

      if (affectsAvailability) {
        const keys = dateKeys(request.startDate, request.endDate)
        const dates = keys.map((key) => new Date(`${key}T00:00:00.000Z`))
        const existing = await tx.mtmWorkCalendarDay.findMany({
          where: {
            organizationId,
            agentId: request.agentId,
            teamId: null,
            date: { in: dates },
            deletedAt: null,
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, date: true },
        })
        const existingByDate = new Map(existing.map((day) => [day.date.toISOString().slice(0, 10), day.id]))
        const calendarName = request.type === "LEAVE" ? "Approved leave" : "Approved absence"
        for (const key of keys) {
          const existingId = existingByDate.get(key)
          if (!existingId) continue
          await tx.mtmWorkCalendarDay.update({
            where: { id: existingId },
            data: {
              kind: "COMPANY_HOLIDAY",
              name: calendarName,
              routePlanningAllowed: false,
              source: "HRM",
              updatedBy: userId,
            },
          })
        }
        const missing = keys.filter((key) => !existingByDate.has(key))
        if (missing.length > 0) {
          await tx.mtmWorkCalendarDay.createMany({
            data: missing.map((key) => ({
              organizationId,
              date: new Date(`${key}T00:00:00.000Z`),
              kind: "COMPANY_HOLIDAY",
              name: calendarName,
              agentId: request.agentId,
              routePlanningAllowed: false,
              source: "HRM",
              createdBy: userId,
              updatedBy: userId,
            })),
          })
        }
      }

      if (input.decision === "APPROVED" && request.type === "TIME_CORRECTION") {
        // Legacy timestamp-without-time-zone fields are application UTC. Pin
        // that contract for this transaction before we read facts that will be
        // written to the immutable correction ledger.
        await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
        // Share the same per-agent fence as the mobile state machine. Without
        // it, a FINISH and a manager correction could both read a stale
        // projection and one would fail only at the completed-workday guard.
        await lockMtmWorkdayTransitions(tx, { organizationId, agentId: request.agentId })
        const workday = await tx.mtmAgentWorkday.findFirst({
          where: {
            id: request.correctionWorkdayId ?? undefined,
            organizationId,
            agentId: request.agentId,
          },
          select: {
            id: true,
            workDate: true,
            status: true,
            startedAt: true,
            pausedAt: true,
            completedAt: true,
            totalPausedSeconds: true,
          },
        })
        if (!workday) throw new DecisionConflict("Workday is no longer available")
        const effectiveStart = request.requestedStartAt ?? workday.startedAt
        const effectiveEnd = request.requestedEndAt ?? workday.completedAt
        if (
          (effectiveEnd && effectiveEnd.getTime() <= effectiveStart.getTime()) ||
          (effectiveEnd && workday.pausedAt && effectiveEnd.getTime() < workday.pausedAt.getTime())
        ) {
          throw new DecisionConflict(
            "Corrected finish time must be after the corrected start time",
            "WORKFORCE_TIME_RANGE_INVALID",
          )
        }
        const completedFromPause = Boolean(request.requestedEndAt && workday.pausedAt)
        const correctedTotalPausedSeconds = completedFromPause && request.requestedEndAt && workday.pausedAt
          ? workday.totalPausedSeconds + pausedSeconds(workday.pausedAt, request.requestedEndAt)
          : workday.totalPausedSeconds
        const workdayUpdate: Prisma.MtmAgentWorkdayUpdateManyMutationInput = {}
        if (request.requestedStartAt) workdayUpdate.startedAt = request.requestedStartAt
        if (request.requestedEndAt) {
          workdayUpdate.completedAt = request.requestedEndAt
          workdayUpdate.status = "COMPLETED"
          workdayUpdate.pausedAt = null
          if (correctedTotalPausedSeconds !== workday.totalPausedSeconds) {
            workdayUpdate.totalPausedSeconds = correctedTotalPausedSeconds
          }
        }
        const previousWorkday = workforceWorkdayCorrectionFacts(workday)
        const correctedWorkday = {
          ...previousWorkday,
          startedAt: effectiveStart.toISOString(),
          completedAt: effectiveEnd?.toISOString() ?? null,
          status: request.requestedEndAt ? "COMPLETED" : previousWorkday.status,
          pausedAt: request.requestedEndAt ? null : previousWorkday.pausedAt,
          totalPausedSeconds: correctedTotalPausedSeconds,
        }
        // Every correction path shares the same append-only proof: replay the
        // raw journal plus the existing ledger, require it to match the
        // current projection, then prove the pending before/after fact does
        // not move a boundary across an immutable pause interval. Without
        // this check an approval could permanently create a ledger chain that
        // no later timesheet calculation can reproduce.
        const [events, corrections] = await Promise.all([
          tx.mtmAgentWorkdayEvent.findMany({
            where: { organizationId, agentId: request.agentId, workdayId: workday.id },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            select: { id: true, type: true, occurredAt: true },
          }),
          tx.workforceTimeCorrection.findMany({
            where: { organizationId, agentId: request.agentId, workdayId: workday.id },
            select: { id: true, beforeFacts: true, afterFacts: true },
          }),
        ])
        try {
          const replayed = replayWorkforceWorkdayFacts({
            workdayId: workday.id,
            events: events.map((event) => ({
              id: event.id,
              type: event.type as "START" | "PAUSE" | "RESUME" | "FINISH",
              occurredAt: event.occurredAt.toISOString(),
            })),
            corrections,
          })
          if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, previousWorkday)) {
            throw new WorkforceWorkdayFactsReplayError(
              "Immutable workday journal does not match its current projection",
            )
          }
          replayWorkforceWorkdayFacts({
            workdayId: workday.id,
            events: events.map((event) => ({
              id: event.id,
              type: event.type as "START" | "PAUSE" | "RESUME" | "FINISH",
              occurredAt: event.occurredAt.toISOString(),
            })),
            corrections: [...corrections, {
              id: "pending-request-correction",
              beforeFacts: previousWorkday,
              afterFacts: correctedWorkday,
            }],
          })
        } catch (error) {
          if (error instanceof WorkforceWorkdayFactsReplayError) {
            throw new DecisionConflict(
              "Workday history cannot support this correction",
              "WORKFORCE_TIME_CORRECTION_HISTORY_INVALID",
            )
          }
          throw error
        }
        // This record is the durable correction ledger. The request id is the
        // stable operation identity for legacy clients, which do not send a
        // separate decision operation id. It is written before the legacy
        // projection changes, inside the same transaction, so a successful
        // mutable update can never exist without its immutable before/after
        // fact.
        const correction = await tx.workforceTimeCorrection.create({
          select: { id: true },
          data: {
            organizationId,
            workdayId: workday.id,
            agentId: request.agentId,
            requestId: request.id,
            source: "REQUEST_APPROVAL",
            operationId: `request-approval:${request.id}`,
            actorUserId: userId,
            reason: input.note || request.reason,
            beforeFacts: previousWorkday,
            afterFacts: correctedWorkday,
            occurredAt: decidedAt,
          },
        })
        // The legacy workday guard accepts a completed-shift mutation only
        // when this transaction explicitly selects the just-created immutable
        // fact. `true` makes the setting transaction-local, so it cannot leak
        // to a later request sharing the database connection.
        await tx.$executeRaw`SELECT set_config('app.workforce_correction_id', ${correction.id}, true)`
        await tx.mtmAgentWorkday.update({ where: { id: workday.id }, data: workdayUpdate })
        // Preserve the established MTM audit projection for existing readers.
        // It supplements, but never replaces, the Workforce immutable ledger
        // written above. A future direct-manager endpoint must use the same
        // before/after contract with source DIRECT_MANAGER.
        await tx.mtmAuditLog.create({
          data: {
            organizationId,
            agentId: request.agentId,
            action: "WORKFORCE_TIME_CORRECTION_APPLIED",
            entity: "workday",
            entityId: workday.id,
            metadataKind: "workforce_time_correction",
            oldData: { workday: previousWorkday },
            newData: {
              workday: correctedWorkday,
              actorUserId: userId,
              requestId: request.id,
              reason: input.note || request.reason,
              source: "REQUEST_APPROVAL",
            },
          },
        })
      }

      await tx.mtmNotification.create({
        data: {
          organizationId,
          agentId: request.agentId,
          title: input.decision === "APPROVED" ? "HR request approved" : "HR request rejected",
          body: input.note || request.reason,
          type: input.decision === "APPROVED" ? "success" : "warning",
          metadata: { domain: "workforce", hrmRequestId: request.id, status: input.decision },
        },
      })
      if (conflictingRoutes.length > 0) {
        await tx.mtmNotification.create({
          data: {
            organizationId,
            agentId: request.agentId,
            title: "Routes need replanning",
            body: `${conflictingRoutes.length} active route(s) overlap the approved absence.`,
            type: "warning",
            // This is a Route & Field projection of an approved Workforce
            // fact. Keep the request id out so a Workforce-only inbox cannot
            // infer route assignments through the shared legacy table.
            metadata: { domain: "route", routeIds: conflictingRoutes.map((route) => route.id) },
          },
        })
      }
      return tx.mtmHrmRequest.findUnique({
        where: { id: request.id },
        select: { id: true, status: true, decisionNote: true, decidedAt: true, updatedAt: true },
      })
    })
    if (!updatedRequest) throw new DecisionConflict("Request disappeared after update")
    data = decisionData(updatedRequest)
  } catch (error) {
    if (error instanceof DecisionConflict) {
      const current = await prisma.mtmHrmRequest.findFirst({
        where: { id: request.id, organizationId },
        select: { id: true, status: true, decisionNote: true, decidedAt: true, updatedAt: true },
      })
      if (current?.status === input.decision) {
        return { kind: "success", data: decisionData(current), conflicts: [], idempotent: true }
      }
      return { kind: "conflict", message: error.message, code: error.code }
    }
    throw error
  }

  await writeMtmAudit({
    organizationId,
    agentId: request.agentId,
    action: "HRM_REQUEST_DECISION",
    entity: "hrm_request",
    entityId: request.id,
    metadataKind: "hrm_request_decision",
    oldData: { status: request.status },
    newData: {
      status: input.decision,
      note: input.note || null,
      conflictingRouteIds: conflictingRoutes.map((route) => route.id),
    },
    req,
  }).catch((error) => console.warn("[workforce/request decision] audit failed", error))

  return { kind: "success", data, conflicts: conflictingRoutes, idempotent: false }
}
