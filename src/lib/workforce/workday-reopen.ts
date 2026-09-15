import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { lockMtmWorkdayTransitions, WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION } from "@/lib/mtm/workday"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import {
  decidePersistedWorkforceAccess,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"
import { isAgentInWorkforceScope, type WorkforceActor } from "@/lib/workforce/actor"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import {
  writeWorkforceWorkdayReopenAuditInTransaction,
  type WorkforceAuditRequestMetadata,
} from "@/lib/workforce/workday-audit"
import {
  workforceWorkdayCorrectionFacts,
  type WorkforceWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-correction-facts"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
  WorkforceWorkdayFactsReplayError,
  type WorkforceWorkdayEventFact,
  type WorkforceWorkdayEventType,
} from "@/lib/workforce/workday-facts-replay"

/**
 * A manager reopens the employee's finished shift for today. The body carries
 * no times: the reopened state is fully determined by the finished workday.
 */
export const WorkforceWorkdayReopenSchema = z.object({
  operationId: z.string().trim().min(8).max(128),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
}).strict()

export type WorkforceWorkdayReopenInput = z.infer<typeof WorkforceWorkdayReopenSchema>

export type WorkforceWorkdayReopenConflictCode =
  | "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH"
  | "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED"
  | "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY"
  | "WORKFORCE_WORKDAY_REOPEN_VERSION_CONFLICT"
  | "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS"
  | "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED"
  | "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING"
  | "WORKFORCE_WORKDAY_REOPEN_CORRECTED"
  | "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID"

type WorkforceWorkdayReopenContext = {
  organizationId: string
  userId: string
  /** A C7 TIME_APPROVER grant may authorize a principal without a CRM actor. */
  actor: WorkforceActor | null
  workdayId: string
  input: WorkforceWorkdayReopenInput
  audit?: WorkforceAuditRequestMetadata
  /** The server clock; injectable only so "today" is deterministic in tests. */
  now?: Date
}

export type WorkforceWorkdayReopenResult =
  | {
    kind: "success"
    data: { reopenId: string; eventId: string; workday: WorkforceWorkdayCorrectionFacts }
    idempotent: boolean
  }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | {
    kind: "conflict"
    code: WorkforceWorkdayReopenConflictCode
    message: string
    currentWorkday?: WorkforceWorkdayCorrectionFacts
  }

class WorkdayReopenProblem extends Error {
  constructor(
    readonly result: Exclude<WorkforceWorkdayReopenResult, { kind: "success" } | { kind: "forbidden" }>,
  ) {
    super(result.kind === "conflict" ? result.message : "Workday not found")
  }
}

function reopenConflict(
  code: WorkforceWorkdayReopenConflictCode,
  message: string,
  currentWorkday?: WorkforceWorkdayCorrectionFacts,
): WorkdayReopenProblem {
  return new WorkdayReopenProblem({
    kind: "conflict",
    code,
    message,
    ...(currentWorkday ? { currentWorkday } : {}),
  })
}

const reopenWorkdaySelect = {
  id: true,
  organizationId: true,
  agentId: true,
  workDate: true,
  status: true,
  startedAt: true,
  pausedAt: true,
  completedAt: true,
  totalPausedSeconds: true,
  updatedAt: true,
  agent: { select: { userId: true } },
} satisfies Prisma.MtmAgentWorkdaySelect

function reopenRequestHash(params: {
  workdayId: string
  actorUserId: string
  input: WorkforceWorkdayReopenInput
}): string {
  const payload = {
    version: 1,
    action: "REOPEN",
    workdayId: params.workdayId,
    actorUserId: params.actorUserId,
    operationId: params.input.operationId,
    expectedUpdatedAt: new Date(params.input.expectedUpdatedAt).toISOString(),
    reason: params.input.reason,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

async function tenantTimezone(organizationId: string): Promise<string> {
  const settings = await getMtmSettings(organizationId)
  return isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
}

function journalFacts(events: ReadonlyArray<{ id: string; type: string; occurredAt: Date }>): WorkforceWorkdayEventFact[] {
  return events.map((event) => ({
    id: event.id,
    type: event.type as WorkforceWorkdayEventType,
    occurredAt: event.occurredAt.toISOString(),
  }))
}

/**
 * Reopens today's COMPLETED workday for a manager in the employee's scope.
 *
 * Owner rules (2026-09-15): a mandatory reason; the closure and the reopen
 * both stay in history; the time between the finish and the employee resuming
 * is never worked time; employees cannot reopen their own day; one shift per
 * day. The shift therefore becomes PAUSED with `pausedAt` at its previous
 * finish and an unchanged closed-pause total, so the ordinary RESUME and
 * FINISH-while-paused transitions bank the gap as pause.
 *
 * In one transaction it appends a REOPEN journal event, an immutable reopen
 * ledger row, selects that row for the database guard (the only way a
 * completed workday may leave COMPLETED), moves the projection and writes the
 * audit record. Past, corrected, approved or contested days are refused.
 */
export async function reopenWorkforceWorkday(
  context: WorkforceWorkdayReopenContext,
): Promise<WorkforceWorkdayReopenResult> {
  const { organizationId, userId, actor, workdayId, input, audit } = context
  const now = context.now ?? new Date()

  const initial = await prisma.mtmAgentWorkday.findFirst({
    where: { id: workdayId, organizationId },
    select: { id: true, agentId: true, agent: { select: { userId: true } } },
  })
  if (!initial) return { kind: "not_found" }
  // Reopening is a supervisor action on someone else's day. Web admins resolve
  // without an agentId, so the target employee's linked user is compared too.
  if (actor?.agentId === initial.agentId || initial.agent.userId === userId) {
    return { kind: "forbidden" }
  }

  const expectedUpdatedAt = new Date(input.expectedUpdatedAt)
  const immutableRequestHash = reopenRequestHash({ workdayId, actorUserId: userId, input })
  const today = currentDateKey(now, await tenantTimezone(organizationId))
  const clientEventId = `reopen:${input.operationId}`

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { features: true },
      })
      const granularAccess = workforceGranularAccessEnabled(organization?.features)
      // Exactly the authority of a direct manager time correction: the legacy
      // CRM manager scope before C7 cutover, a TIME_CORRECT grant after it.
      if (!granularAccess) {
        if (!actor || actor.role === "AGENT" || !isAgentInWorkforceScope(actor, initial.agentId)) {
          return { kind: "forbidden" as const }
        }
      } else {
        const access = await decidePersistedWorkforceAccess({
          db: tx as WorkforceAccessGrantReaderDb,
          organizationId,
          principalUserId: userId,
          selfAgentId: null,
          permission: "TIME_CORRECT",
          resource: { organizationId, agentId: initial.agentId },
        })
        if (!access.allowed) return { kind: "forbidden" as const }
      }
      // Legacy timestamp-without-time-zone fields stay deterministic while the
      // guard compares them with the ledger's canonical UTC facts.
      await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
      // Turns the tenant-scoped unique operation key into deterministic replay
      // semantics for two concurrent requests carrying the same key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-workday-reopen:${organizationId}:${input.operationId}`}))`

      const existing = await tx.workforceWorkdayReopen.findFirst({
        where: { organizationId, operationId: input.operationId },
        select: {
          id: true,
          workdayId: true,
          agentId: true,
          eventId: true,
          actorUserId: true,
          requestHash: true,
        },
      })
      if (existing) {
        if (
          existing.workdayId !== workdayId
          || existing.agentId !== initial.agentId
          || existing.actorUserId !== userId
          || existing.requestHash !== immutableRequestHash
        ) {
          throw reopenConflict(
            "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH",
            "operationId was already used for a different workday reopen",
          )
        }
        await lockMtmWorkdayTransitions(tx, { organizationId, agentId: initial.agentId })
        const current = await tx.mtmAgentWorkday.findFirst({
          where: { id: workdayId, organizationId, agentId: initial.agentId },
          select: reopenWorkdaySelect,
        })
        if (!current) throw new WorkdayReopenProblem({ kind: "not_found" })
        // Repeat the self check under the lock that returns the replay: an
        // employee linked to this user after the preflight gets no receipt.
        if (current.agent.userId === userId) return { kind: "forbidden" as const }
        // The same operation is acknowledged once more, never applied twice.
        // The employee may already have resumed, so report today's state.
        return {
          kind: "success" as const,
          data: {
            reopenId: existing.id,
            eventId: existing.eventId,
            workday: workforceWorkdayCorrectionFacts(current),
          },
          idempotent: true,
        }
      }

      await lockMtmWorkdayTransitions(tx, { organizationId, agentId: initial.agentId })
      const workday = await tx.mtmAgentWorkday.findFirst({
        where: { id: workdayId, organizationId, agentId: initial.agentId },
        select: reopenWorkdaySelect,
      })
      if (!workday) throw new WorkdayReopenProblem({ kind: "not_found" })
      if (workday.agent.userId === userId) return { kind: "forbidden" as const }

      const beforeWorkday = workforceWorkdayCorrectionFacts(workday)
      if (workday.status !== "COMPLETED" || !workday.completedAt) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED",
          "Only a completed workday can be reopened",
          beforeWorkday,
        )
      }
      if (beforeWorkday.workDate !== today) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY",
          "Only today's workday can be reopened",
          beforeWorkday,
        )
      }
      if (workday.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_VERSION_CONFLICT",
          "Workday changed since it was opened for reopening",
          beforeWorkday,
        )
      }

      const [otherOpenWorkday, approval, pendingCorrection, corrections, events, eventKeyOwner] = await Promise.all([
        tx.mtmAgentWorkday.findFirst({
          where: {
            organizationId,
            agentId: initial.agentId,
            status: { in: ["STARTED", "PAUSED"] },
            id: { not: workdayId },
          },
          select: { id: true },
        }),
        tx.workforceTimesheetApproval.findFirst({
          where: {
            organizationId,
            agentId: initial.agentId,
            periodStart: { lte: workday.workDate },
            periodEnd: { gte: workday.workDate },
          },
          select: { id: true },
        }),
        tx.mtmHrmRequest.findFirst({
          where: {
            organizationId,
            agentId: initial.agentId,
            type: "TIME_CORRECTION",
            status: "PENDING",
            correctionWorkdayId: workdayId,
          },
          select: { id: true },
        }),
        tx.workforceTimeCorrection.findMany({
          where: { organizationId, agentId: initial.agentId, workdayId },
          select: { id: true },
        }),
        tx.mtmAgentWorkdayEvent.findMany({
          where: { organizationId, agentId: initial.agentId, workdayId },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: { id: true, type: true, occurredAt: true },
        }),
        tx.mtmAgentWorkdayEvent.findFirst({
          where: { organizationId, agentId: initial.agentId, clientEventId },
          select: { id: true },
        }),
      ])
      if (otherOpenWorkday) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS",
          "The employee already has another open workday",
          beforeWorkday,
        )
      }
      if (approval) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED",
          "An approved timesheet already covers this workday",
          beforeWorkday,
        )
      }
      if (pendingCorrection) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING",
          "A time-correction request for this workday is still pending",
          beforeWorkday,
        )
      }
      // The correction ledger replays after the whole journal. A REOPEN after
      // a correction would split that chain, so corrected days stay closed.
      if (corrections.length > 0) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_CORRECTED",
          "A corrected workday cannot be reopened",
          beforeWorkday,
        )
      }
      if (eventKeyOwner) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH",
          "operationId was already used for a different workday event",
        )
      }

      const afterWorkday: WorkforceWorkdayCorrectionFacts = {
        ...beforeWorkday,
        status: "PAUSED",
        pausedAt: beforeWorkday.completedAt,
        completedAt: null,
      }
      // Prove the immutable journal reproduces the row before a REOPEN extends
      // it, and that the extended journal reproduces exactly the reopened row.
      // A finish claimed later than the server clock fails the second replay.
      const journal = journalFacts(events)
      let historyProblem: string | null = null
      try {
        const replayed = replayWorkforceWorkdayFacts({ workdayId, events: journal })
        if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, beforeWorkday)) {
          historyProblem = "Immutable workday journal does not match its current projection"
        } else {
          const reopened = replayWorkforceWorkdayFacts({
            workdayId,
            events: [...journal, { id: "pending-workday-reopen", type: "REOPEN", occurredAt: now.toISOString() }],
          })
          if (!workforceReplayMatchesWorkdayCorrectionFacts(reopened, afterWorkday)) {
            historyProblem = "Reopened workday journal does not reproduce the reopened projection"
          }
        }
      } catch (error) {
        if (!(error instanceof WorkforceWorkdayFactsReplayError)) throw error
        historyProblem = error.message
      }
      if (historyProblem) {
        throw reopenConflict("WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID", historyProblem, beforeWorkday)
      }

      // Journal first: the ledger references its REOPEN event, and the guard
      // accepts the projection change only against the ledger row selected
      // below in this same transaction.
      const event = await tx.mtmAgentWorkdayEvent.create({
        select: { id: true },
        data: {
          organizationId,
          agentId: initial.agentId,
          workdayId,
          clientEventId,
          type: "REOPEN",
          occurredAt: now,
          claimedAt: now,
          capturedAt: now,
          queuedAt: now,
          serverReceivedAt: now,
          appliedAt: now,
          schemaVersion: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
          requestHash: immutableRequestHash,
          // The server produced this fact itself; there is no delayed client
          // claim for a reviewer to assess.
          attendanceReviewState: "NOT_REQUIRED",
          attendanceReviewReasonCode: null,
          latitude: null,
          longitude: null,
          accuracy: null,
          note: input.reason,
        },
      })
      const reopen = await tx.workforceWorkdayReopen.create({
        select: { id: true },
        data: {
          organizationId,
          agentId: initial.agentId,
          workdayId,
          eventId: event.id,
          operationId: input.operationId,
          requestHash: immutableRequestHash,
          actorUserId: userId,
          reason: input.reason,
          beforeFacts: beforeWorkday,
          afterFacts: afterWorkday,
          occurredAt: now,
        },
      })
      // Transaction-local, so it cannot leak to a later request that reuses
      // the pooled database connection.
      await tx.$executeRaw`SELECT set_config('app.workforce_reopen_id', ${reopen.id}, true)`
      await tx.mtmAgentWorkday.update({
        where: { id: workdayId },
        data: {
          status: "PAUSED",
          pausedAt: workday.completedAt,
          completedAt: null,
        },
      })
      await writeWorkforceWorkdayReopenAuditInTransaction(tx, {
        scope: { organizationId, agentId: initial.agentId },
        reopenId: reopen.id,
        eventId: event.id,
        actorUserId: userId,
        operationId: input.operationId,
        reason: input.reason,
        authorizationSource: granularAccess ? "WORKFORCE_GRANT" : actor!.role,
        beforeWorkday,
        afterWorkday,
        requestMetadata: audit,
      })

      return {
        kind: "success" as const,
        data: { reopenId: reopen.id, eventId: event.id, workday: afterWorkday },
        idempotent: false,
      }
    })
  } catch (error) {
    if (error instanceof WorkdayReopenProblem) return error.result
    throw error
  }
}
