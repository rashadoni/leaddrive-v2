import { Prisma } from "@prisma/client"
import {
  lockMtmWorkdayTransitions,
  MTM_WORKDAY_REOPEN_UNDO_EVENT_KEY_PREFIX,
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import { prisma } from "@/lib/prisma"
import { writeWorkforceWorkdayReopenUndoAuditInTransaction } from "@/lib/workforce/workday-audit"
import {
  workforceWorkdayCorrectionFacts,
  type WorkforceWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-correction-facts"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
  workforceWorkdayEventFact,
  WorkforceWorkdayFactsReplayError,
  type WorkforceTimeCorrectionReplayFact,
  type WorkforceWorkdayEventFact,
} from "@/lib/workforce/workday-facts-replay"
import {
  authorizeWorkforceWorkdayManagerAction,
  isWorkforceWorkdayOwnDay,
  readWorkforceWorkdayJournal,
  workforceReopenWorkdaySelect,
  workforceTenantToday,
  WorkforceWorkdayReopenSchema,
  workforceWorkdayReopenRequestHash,
  type WorkforceWorkdayReopenContext,
  type WorkforceWorkdayScope,
} from "@/lib/workforce/workday-reopen"
import type { WorkforceWorkdayReopenUndoConflictCode } from "@/lib/workforce/workday-reopen-contract"

export type { WorkforceWorkdayReopenUndoConflictCode } from "@/lib/workforce/workday-reopen-contract"

/** Same body as the reopen itself: an operation id, the version seen, a reason. */
export const WorkforceWorkdayReopenUndoSchema = WorkforceWorkdayReopenSchema

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

/** The journal key of the FINISH an undo operation writes. */
export function workforceWorkdayReopenUndoEventKey(operationId: string): string {
  return `${MTM_WORKDAY_REOPEN_UNDO_EVENT_KEY_PREFIX}${operationId}`
}

export type WorkforceWorkdayReopenUndoStateConflictCode = Extract<
  WorkforceWorkdayReopenUndoConflictCode,
  "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED" | "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY"
>

/**
 * What the day's own facts say about an undo: the day is paused, and it is
 * today's.
 *
 * Undo is a same-day correction of the manager's own mistake. A reopen left
 * open past midnight is no longer undone here: that day is handled by the
 * existing prior-day / left-open workday flow (missed-finish review), which
 * v1 of the reopen feature deliberately does not replace.
 */
export function workforceWorkdayReopenUndoStateConflict(
  workday: Pick<WorkforceWorkdayCorrectionFacts, "status" | "pausedAt" | "workDate">,
  today: string,
): WorkforceWorkdayReopenUndoStateConflictCode | null {
  if (workday.status !== "PAUSED" || !workday.pausedAt) return "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED"
  if (workday.workDate !== today) return "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY"
  return null
}

/**
 * The REOPEN an undo takes back. It is still the journal's last event —
 * anything the employee did after the reopen (RESUME, then perhaps PAUSE
 * again) is the last event instead, and the day is theirs again — recorded at
 * the instant the open pause began.
 */
export function workforceWorkdayUndoableReopenEvent<Event extends { id: string; type: string; occurredAt: Date }>(
  journal: readonly Event[],
  pausedAt: Date,
): Event | null {
  const last = journal.at(-1)
  return last?.type === "REOPEN" && last.occurredAt.getTime() === pausedAt.getTime() ? last : null
}

/** The immutable ledger row that makes that REOPEN a manager's reopen. */
export async function findWorkforceWorkdayReopenLedgerRow(
  db: Pick<Prisma.TransactionClient, "workforceWorkdayReopen">,
  params: WorkforceWorkdayScope & { eventId: string },
): Promise<{ id: string } | null> {
  return db.workforceWorkdayReopen.findFirst({
    where: {
      organizationId: params.organizationId,
      agentId: params.agentId,
      workdayId: params.workdayId,
      eventId: params.eventId,
    },
    select: { id: true },
  })
}

/** The day's immutable correction chain, replayed after its journal. */
export async function readWorkforceWorkdayReplayCorrections(
  db: Pick<Prisma.TransactionClient, "workforceTimeCorrection">,
  scope: WorkforceWorkdayScope,
) {
  return db.workforceTimeCorrection.findMany({
    where: { organizationId: scope.organizationId, agentId: scope.agentId, workdayId: scope.workdayId },
    select: { id: true, beforeFacts: true, afterFacts: true },
  })
}

/** The projection an undo restores: finished again at the reopened instant. */
export function workforceUndoneReopenWorkdayFacts(
  before: WorkforceWorkdayCorrectionFacts,
): WorkforceWorkdayCorrectionFacts {
  return {
    ...before,
    status: "COMPLETED",
    pausedAt: null,
    completedAt: before.pausedAt,
  }
}

/**
 * Proves the immutable journal and correction chain reproduce the reopened
 * row, and that an undo FINISH at the reopened instant reproduces exactly the
 * finished row. Returns why they do not, or null.
 */
export function workforceWorkdayReopenUndoHistoryProblem(params: {
  workdayId: string
  journal: readonly WorkforceWorkdayEventFact[]
  corrections: readonly WorkforceTimeCorrectionReplayFact[]
  before: WorkforceWorkdayCorrectionFacts
  /** The start of the reopened pause: the original finish. */
  pauseStartedAt: Date
  /** When the server applies the undo FINISH. */
  appliedAt: Date
  /** The undo FINISH's journal key; replay recognises it by its reserved prefix. */
  clientEventId: string
}): string | null {
  const { workdayId, journal, corrections, before } = params
  try {
    const replayed = replayWorkforceWorkdayFacts({ workdayId, events: journal, corrections })
    if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, before)) {
      return "Immutable workday journal does not match its current projection"
    }
    const restored = replayWorkforceWorkdayFacts({
      workdayId,
      events: [...journal, {
        id: "pending-workday-reopen-undo",
        type: "FINISH",
        occurredAt: params.pauseStartedAt.toISOString(),
        appliedAt: params.appliedAt.toISOString(),
        clientEventId: params.clientEventId,
      }],
      corrections,
    })
    if (!workforceReplayMatchesWorkdayCorrectionFacts(restored, workforceUndoneReopenWorkdayFacts(before))) {
      return "Undone reopen does not reproduce the finished projection"
    }
    return null
  } catch (error) {
    if (!(error instanceof WorkforceWorkdayFactsReplayError)) throw error
    return error.message
  }
}

const UNDO_REFUSAL_MESSAGES: Record<WorkforceWorkdayReopenUndoStateConflictCode, string> = {
  WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED:
    "Only a reopened workday the employee has not resumed or finished can be undone",
  WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY: "Only today's reopen can be undone",
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
 *
 * The refusals are the exported predicates above, which the operational week
 * also evaluates to tell a manager in advance whether the undo is possible.
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
  if (isWorkforceWorkdayOwnDay({ actor, userId, agentId: initial.agentId, agentUserId: initial.agent.userId })) {
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
  const clientEventId = workforceWorkdayReopenUndoEventKey(input.operationId)
  const scope = { organizationId, agentId: initial.agentId }
  const workdayScope: WorkforceWorkdayScope = { ...scope, workdayId }

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
      if (isWorkforceWorkdayOwnDay({ actor, userId, agentId: initial.agentId, agentUserId: workday.agent.userId })) {
        return { kind: "forbidden" as const }
      }
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
      // Paused and today's; a reopen left open past midnight belongs to the
      // prior-day flow (see workforceWorkdayReopenUndoStateConflict).
      const stateConflict = workforceWorkdayReopenUndoStateConflict(beforeWorkday, today)
      if (stateConflict || !pauseStartedAt) {
        const code = stateConflict ?? "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED"
        throw undoConflict(code, UNDO_REFUSAL_MESSAGES[code], beforeWorkday)
      }

      const [events, corrections] = await Promise.all([
        readWorkforceWorkdayJournal(tx, workdayScope),
        readWorkforceWorkdayReplayCorrections(tx, workdayScope),
      ])
      const reopenEvent = workforceWorkdayUndoableReopenEvent(events, pauseStartedAt)
      const reopen = reopenEvent
        ? await findWorkforceWorkdayReopenLedgerRow(tx, { ...workdayScope, eventId: reopenEvent.id })
        : null
      if (!reopenEvent || !reopen) {
        throw undoConflict(
          "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED",
          UNDO_REFUSAL_MESSAGES.WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED,
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

      const afterWorkday = workforceUndoneReopenWorkdayFacts(beforeWorkday)
      const historyProblem = workforceWorkdayReopenUndoHistoryProblem({
        workdayId,
        journal: events.map(workforceWorkdayEventFact),
        corrections,
        before: beforeWorkday,
        pauseStartedAt,
        appliedAt: now,
        clientEventId,
      })
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
