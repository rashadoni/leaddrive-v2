import { Prisma } from "@prisma/client"
import { lockMtmWorkdayTransitions, WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION } from "@/lib/mtm/workday"
import { prisma } from "@/lib/prisma"
import { writeWorkforceWorkdayReopenUndoAuditInTransaction } from "@/lib/workforce/workday-audit"
import {
  workforceWorkdayCorrectionFacts,
  type WorkforceWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-correction-facts"
import {
  replayWorkforceWorkdayFacts,
  WORKFORCE_WORKDAY_JOURNAL_ORDER,
  workforceReplayMatchesWorkdayCorrectionFacts,
  WorkforceWorkdayFactsReplayError,
} from "@/lib/workforce/workday-facts-replay"
import {
  authorizeWorkforceWorkdayManagerAction,
  workforceReopenWorkdaySelect,
  workforceTenantToday,
  WorkforceWorkdayReopenSchema,
  workforceWorkdayJournalFacts,
  workforceWorkdayReopenRequestHash,
  type WorkforceWorkdayReopenContext,
} from "@/lib/workforce/workday-reopen"

/** Same body as the reopen itself: an operation id, the version seen, a reason. */
export const WorkforceWorkdayReopenUndoSchema = WorkforceWorkdayReopenSchema

export type WorkforceWorkdayReopenUndoConflictCode =
  | "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED"
  | "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY"
  | "WORKFORCE_WORKDAY_REOPEN_UNDO_VERSION_CONFLICT"
  | "WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH"
  | "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID"

export type WorkforceWorkdayReopenUndoResult =
  | {
    kind: "success"
    data: { eventId: string; workday: WorkforceWorkdayCorrectionFacts }
    idempotent: boolean
  }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | {
    kind: "conflict"
    code: WorkforceWorkdayReopenUndoConflictCode
    message: string
    currentWorkday?: WorkforceWorkdayCorrectionFacts
  }

class WorkdayReopenUndoProblem extends Error {
  constructor(
    readonly result: Exclude<WorkforceWorkdayReopenUndoResult, { kind: "success" } | { kind: "forbidden" }>,
  ) {
    super(result.kind === "conflict" ? result.message : "Workday not found")
  }
}

function undoConflict(
  code: WorkforceWorkdayReopenUndoConflictCode,
  message: string,
  currentWorkday?: WorkforceWorkdayCorrectionFacts,
): WorkdayReopenUndoProblem {
  return new WorkdayReopenUndoProblem({
    kind: "conflict",
    code,
    message,
    ...(currentWorkday ? { currentWorkday } : {}),
  })
}

/**
 * Undoes a manager's mistaken reopen of today's workday, as long as the
 * employee has not acted on the reopened day since: it stays PAUSED and the
 * last journal event is still that REOPEN.
 *
 * The undo is an ordinary FINISH, recorded at the instant the reopened pause
 * began (the original finish). It therefore adds no pause time and returns
 * `completedAt` to exactly its original value, while the FINISH, the REOPEN
 * and this undo all stay in the journal. The completed-workday guard needs no
 * exception: the update leaves PAUSED, not COMPLETED. The event note carries
 * the reason; the manager, the undone reopen and the before/after facts are in
 * the WORKDAY_REOPEN_UNDO audit record written in the same transaction.
 */
export async function undoWorkforceWorkdayReopen(
  context: WorkforceWorkdayReopenContext,
): Promise<WorkforceWorkdayReopenUndoResult> {
  const { organizationId, userId, actor, workdayId, input, audit } = context
  const now = context.now ?? new Date()

  const initial = await prisma.mtmAgentWorkday.findFirst({
    where: { id: workdayId, organizationId },
    select: { id: true, agentId: true, agent: { select: { userId: true } } },
  })
  if (!initial) return { kind: "not_found" }
  if (actor?.agentId === initial.agentId || initial.agent.userId === userId) {
    return { kind: "forbidden" }
  }

  const expectedUpdatedAt = new Date(input.expectedUpdatedAt)
  const immutableRequestHash = workforceWorkdayReopenRequestHash({
    action: "REOPEN_UNDO",
    workdayId,
    actorUserId: userId,
    input,
  })
  const today = await workforceTenantToday(organizationId, now)
  const clientEventId = `reopen-undo:${input.operationId}`
  const scope = { organizationId, agentId: initial.agentId }

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const authorizationSource = await authorizeWorkforceWorkdayManagerAction(tx, {
        organizationId,
        userId,
        actor,
        agentId: initial.agentId,
      })
      if (!authorizationSource) return { kind: "forbidden" as const }
      await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-workday-reopen-undo:${organizationId}:${input.operationId}`}))`
      await lockMtmWorkdayTransitions(tx, scope)

      const [existing, workday] = await Promise.all([
        tx.mtmAgentWorkdayEvent.findFirst({
          where: { organizationId, agentId: initial.agentId, clientEventId },
          select: { id: true, type: true, workdayId: true, requestHash: true },
        }),
        tx.mtmAgentWorkday.findFirst({
          where: { id: workdayId, organizationId, agentId: initial.agentId },
          select: workforceReopenWorkdaySelect,
        }),
      ])
      if (!workday) throw new WorkdayReopenUndoProblem({ kind: "not_found" })
      if (workday.agent.userId === userId) return { kind: "forbidden" as const }
      const beforeWorkday = workforceWorkdayCorrectionFacts(workday)

      if (existing) {
        // The event is the undo's own idempotency record: its hash binds the
        // manager, target, expected version and reason of the first request.
        if (
          existing.type !== "FINISH"
          || existing.workdayId !== workdayId
          || existing.requestHash !== immutableRequestHash
        ) {
          throw undoConflict(
            "WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH",
            "operationId was already used for a different workday event",
          )
        }
        return {
          kind: "success" as const,
          data: { eventId: existing.id, workday: beforeWorkday },
          idempotent: true,
        }
      }

      const pauseStartedAt = workday.pausedAt
      if (workday.status !== "PAUSED" || !pauseStartedAt) {
        throw undoConflict(
          "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
          "Only a reopened workday the employee has not resumed or finished can be undone",
          beforeWorkday,
        )
      }
      if (beforeWorkday.workDate !== today) {
        throw undoConflict(
          "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY",
          "Only today's reopen can be undone",
          beforeWorkday,
        )
      }

      const [events, corrections] = await Promise.all([
        tx.mtmAgentWorkdayEvent.findMany({
          where: { organizationId, agentId: initial.agentId, workdayId },
          orderBy: [...WORKFORCE_WORKDAY_JOURNAL_ORDER],
          select: { id: true, type: true, occurredAt: true },
        }),
        tx.workforceTimeCorrection.findMany({
          where: { organizationId, agentId: initial.agentId, workdayId },
          select: { id: true, beforeFacts: true, afterFacts: true },
        }),
      ])
      // Anything the employee did after the reopen (RESUME, then perhaps PAUSE
      // again) is the last event instead, and the day is theirs again.
      const reopenEvent = events.at(-1)
      const reopen = reopenEvent?.type === "REOPEN"
        && reopenEvent.occurredAt.getTime() === pauseStartedAt.getTime()
        ? await tx.workforceWorkdayReopen.findFirst({
          where: { organizationId, agentId: initial.agentId, workdayId, eventId: reopenEvent.id },
          select: { id: true },
        })
        : null
      if (!reopenEvent || !reopen) {
        throw undoConflict(
          "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
          "Only a reopened workday the employee has not resumed or finished can be undone",
          beforeWorkday,
        )
      }
      if (workday.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw undoConflict(
          "WORKFORCE_WORKDAY_REOPEN_UNDO_VERSION_CONFLICT",
          "Workday changed since it was opened for undoing the reopen",
          beforeWorkday,
        )
      }

      const afterWorkday: WorkforceWorkdayCorrectionFacts = {
        ...beforeWorkday,
        status: "COMPLETED",
        pausedAt: null,
        completedAt: beforeWorkday.pausedAt,
      }
      const journal = workforceWorkdayJournalFacts(events)
      let historyProblem: string | null = null
      try {
        const replayed = replayWorkforceWorkdayFacts({ workdayId, events: journal, corrections })
        if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, beforeWorkday)) {
          historyProblem = "Immutable workday journal does not match its current projection"
        } else {
          const restored = replayWorkforceWorkdayFacts({
            workdayId,
            events: [...journal, { id: "pending-workday-reopen-undo", type: "FINISH", occurredAt: pauseStartedAt.toISOString() }],
            corrections,
          })
          if (!workforceReplayMatchesWorkdayCorrectionFacts(restored, afterWorkday)) {
            historyProblem = "Undone reopen does not reproduce the finished projection"
          }
        }
      } catch (error) {
        if (!(error instanceof WorkforceWorkdayFactsReplayError)) throw error
        historyProblem = error.message
      }
      if (historyProblem) {
        throw undoConflict("WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID", historyProblem, beforeWorkday)
      }

      const event = await tx.mtmAgentWorkdayEvent.create({
        select: { id: true },
        data: {
          organizationId,
          agentId: initial.agentId,
          workdayId,
          clientEventId,
          type: "FINISH",
          // The finish the reopen interrupted, to the millisecond: no pause is
          // added and completedAt is restored exactly.
          occurredAt: pauseStartedAt,
          claimedAt: pauseStartedAt,
          capturedAt: pauseStartedAt,
          queuedAt: null,
          serverReceivedAt: now,
          appliedAt: now,
          schemaVersion: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
          requestHash: immutableRequestHash,
          attendanceReviewState: "NOT_REQUIRED",
          attendanceReviewReasonCode: null,
          // The manager's action has no location; the day keeps the end
          // coordinates of the original finish.
          latitude: null,
          longitude: null,
          accuracy: null,
          note: input.reason,
        },
      })
      await tx.mtmAgentWorkday.update({
        where: { id: workdayId },
        data: {
          status: "COMPLETED",
          pausedAt: null,
          completedAt: pauseStartedAt,
        },
      })
      // As for any finished day, the employee leaves the live map.
      await tx.mtmAgent.updateMany({
        where: { id: initial.agentId, organizationId },
        data: { isOnline: false },
      })
      await writeWorkforceWorkdayReopenUndoAuditInTransaction(tx, {
        scope,
        reopenId: reopen.id,
        reopenEventId: reopenEvent.id,
        eventId: event.id,
        actorUserId: userId,
        operationId: input.operationId,
        reason: input.reason,
        authorizationSource,
        beforeWorkday,
        afterWorkday,
        requestMetadata: audit,
      })

      return {
        kind: "success" as const,
        data: { eventId: event.id, workday: afterWorkday },
        idempotent: false,
      }
    })
  } catch (error) {
    if (error instanceof WorkdayReopenUndoProblem) return error.result
    throw error
  }
}
