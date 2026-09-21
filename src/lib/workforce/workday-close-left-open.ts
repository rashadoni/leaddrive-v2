import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import {
  lockMtmWorkdayTransitions,
  MTM_WORKDAY_CLOSE_LEFT_OPEN_EVENT_KEY_PREFIX,
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import { isMtmWorkdayLeftOpen } from "@/lib/mtm/workday-open-anomaly"
import { prisma } from "@/lib/prisma"
import { writeWorkforceWorkdayCloseAuditInTransaction } from "@/lib/workforce/workday-audit"
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
  readWorkforceWorkdayReopenBlockers,
  workforceReopenWorkdaySelect,
  type WorkforceWorkdayScope,
} from "@/lib/workforce/workday-reopen"
import { readWorkforceWorkdayReplayCorrections } from "@/lib/workforce/workday-reopen-undo"
import {
  WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH,
  WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH,
  type WorkforceWorkdayCloseConflictCode,
} from "@/lib/workforce/workday-reopen-contract"
import type { WorkforceActor } from "@/lib/workforce/actor"
import type { WorkforceAuditRequestMetadata } from "@/lib/workforce/workday-audit"

export type { WorkforceWorkdayCloseConflictCode } from "@/lib/workforce/workday-reopen-contract"

/**
 * Audit 2026-09-21: shifts left open for 19 and 64 days, and no way for a
 * manager to end them — the Panel could only point at the agent's week. Every
 * report of worked time read those rows as still running.
 *
 * A manager closes such a shift with an explicit finish time and a reason.
 * Nothing is closed automatically: the finish of a shift nobody ended is a
 * judgement about someone's working time, and the journal must say who made
 * it. The form starts from the employee's last trace in that shift (a GPS point
 * or a visit), which is the latest moment the data can show them working.
 */
export const WorkforceWorkdayCloseSchema = z.object({
  operationId: z.string().trim().min(8).max(128),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim()
    .min(WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH)
    .max(WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH),
}).strict()

export type WorkforceWorkdayCloseInput = z.infer<typeof WorkforceWorkdayCloseSchema>

export type WorkforceWorkdayCloseContext = {
  organizationId: string
  userId: string
  actor: WorkforceActor | null
  workdayId: string
  input: WorkforceWorkdayCloseInput
  audit?: WorkforceAuditRequestMetadata
  now?: Date
}

export type WorkforceWorkdayCloseResult =
  | { kind: "success"; data: { eventId: string; workday: WorkforceWorkdayCorrectionFacts }; idempotent: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | {
    kind: "conflict"
    code: WorkforceWorkdayCloseConflictCode
    message: string
    currentWorkday?: WorkforceWorkdayCorrectionFacts
  }

class WorkdayCloseProblem extends Error {
  constructor(
    readonly result: Exclude<WorkforceWorkdayCloseResult, { kind: "success" } | { kind: "forbidden" }>,
  ) {
    super(result.kind === "conflict" ? result.message : "Workday not found")
  }
}

function closeConflict(
  code: WorkforceWorkdayCloseConflictCode,
  message: string,
  currentWorkday?: WorkforceWorkdayCorrectionFacts,
): WorkdayCloseProblem {
  return new WorkdayCloseProblem({ kind: "conflict", code, message, ...(currentWorkday ? { currentWorkday } : {}) })
}

/** The journal key of the FINISH a close operation writes. */
export function workforceWorkdayCloseEventKey(operationId: string): string {
  return `${MTM_WORKDAY_CLOSE_LEFT_OPEN_EVENT_KEY_PREFIX}${operationId}`
}

/** Binds a close operation id to its actor, target and exact body. */
export function workforceWorkdayCloseRequestHash(params: {
  workdayId: string
  actorUserId: string
  input: WorkforceWorkdayCloseInput
}): string {
  const payload = {
    version: 1,
    action: "CLOSE_LEFT_OPEN",
    workdayId: params.workdayId,
    actorUserId: params.actorUserId,
    operationId: params.input.operationId,
    expectedUpdatedAt: new Date(params.input.expectedUpdatedAt).toISOString(),
    finishedAt: new Date(params.input.finishedAt).toISOString(),
    reason: params.input.reason,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

/** Only a STARTED or PAUSED shift past the left-open threshold can be closed by a manager. */
export function workforceWorkdayCloseStateConflict(
  workday: Pick<WorkforceWorkdayCorrectionFacts, "status" | "startedAt" | "pausedAt">,
  now: Date,
): "WORKFORCE_WORKDAY_CLOSE_NOT_LEFT_OPEN" | null {
  return isMtmWorkdayLeftOpen(workday, now) ? null : "WORKFORCE_WORKDAY_CLOSE_NOT_LEFT_OPEN"
}

/** A finish must follow the shift's last journal event and cannot lie in the future. */
export function workforceWorkdayCloseFinishInRange(params: {
  finishedAt: Date
  lastEventAt: Date
  now: Date
}): boolean {
  const finish = params.finishedAt.getTime()
  return Number.isFinite(finish) && finish > params.lastEventAt.getTime() && finish <= params.now.getTime()
}

function ceilToMinute(ms: number): number {
  return Math.ceil(ms / 60_000) * 60_000
}

/**
 * Where the manager's form starts: the latest trace of the employee in the
 * shift, rounded up to a whole minute (the form edits minutes) and strictly
 * after the last journal event. A shift with no trace at all starts one
 * minute after its last event — the data shows no work, and the manager says
 * otherwise only by choosing a later time.
 */
export function workforceWorkdayCloseSuggestedFinish(params: {
  lastEventAt: Date
  traces: ReadonlyArray<Date | null | undefined>
  now: Date
}): Date {
  const floor = params.lastEventAt.getTime()
  const nowMs = params.now.getTime()
  let latest = floor
  for (const trace of params.traces) {
    const ms = trace?.getTime()
    if (ms != null && Number.isFinite(ms) && ms <= nowMs && ms > latest) latest = ms
  }
  let candidate = ceilToMinute(latest)
  if (candidate <= floor) candidate += 60_000
  return new Date(Math.min(candidate, nowMs))
}

/** Evidence stays inside the shift's own day; later traces belong to later work. */
const CLOSE_TRACE_WINDOW_MS = 24 * 60 * 60 * 1000

export type WorkforceWorkdayCloseTracesDb = Pick<Prisma.TransactionClient, "mtmAgentLocation" | "mtmVisit">

/** The employee's latest GPS point and visit inside the shift. */
export async function readWorkforceWorkdayCloseTraces(
  db: WorkforceWorkdayCloseTracesDb,
  params: WorkforceWorkdayScope & { startedAt: Date; now: Date },
): Promise<Date[]> {
  const windowEnd = new Date(Math.min(params.startedAt.getTime() + CLOSE_TRACE_WINDOW_MS, params.now.getTime()))
  const [location, visit] = await Promise.all([
    db.mtmAgentLocation.findFirst({
      where: {
        organizationId: params.organizationId,
        agentId: params.agentId,
        workdayId: params.workdayId,
        recordedAt: { lte: windowEnd },
      },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true },
    }),
    db.mtmVisit.findFirst({
      where: {
        organizationId: params.organizationId,
        agentId: params.agentId,
        checkInAt: { gte: params.startedAt, lte: windowEnd },
      },
      orderBy: { checkInAt: "desc" },
      select: { checkInAt: true, checkOutAt: true },
    }),
  ])
  const visitEnd = visit?.checkOutAt && visit.checkOutAt.getTime() <= windowEnd.getTime() ? visit.checkOutAt : visit?.checkInAt
  return [location?.recordedAt, visitEnd].filter((value): value is Date => value instanceof Date)
}

/**
 * Proves the journal (and any correction chain) reproduces the open row, and
 * returns the projection the journal produces once the manager's FINISH is
 * appended — the row is updated to exactly that. A string is the reason the
 * history refuses the close.
 */
export function workforceWorkdayCloseReplay(params: {
  workdayId: string
  journal: readonly WorkforceWorkdayEventFact[]
  corrections: readonly WorkforceTimeCorrectionReplayFact[]
  before: WorkforceWorkdayCorrectionFacts
  finishedAt: Date
  appliedAt: Date
  clientEventId: string
}): { after: WorkforceWorkdayCorrectionFacts } | { problem: string } {
  const { workdayId, journal, corrections, before } = params
  try {
    const replayed = replayWorkforceWorkdayFacts({ workdayId, events: journal, corrections })
    if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, before)) {
      return { problem: "Immutable workday journal does not match its current projection" }
    }
    const closed = replayWorkforceWorkdayFacts({
      workdayId,
      events: [...journal, {
        id: "pending-workday-close",
        type: "FINISH",
        occurredAt: params.finishedAt.toISOString(),
        appliedAt: params.appliedAt.toISOString(),
        clientEventId: params.clientEventId,
      }],
      corrections,
    })
    return {
      after: {
        ...before,
        status: "COMPLETED",
        pausedAt: null,
        completedAt: closed.completedAt ?? params.finishedAt.toISOString(),
        totalPausedSeconds: closed.totalPausedSeconds,
      },
    }
  } catch (error) {
    if (!(error instanceof WorkforceWorkdayFactsReplayError)) throw error
    return { problem: error.message }
  }
}

const CLOSE_REFUSAL_MESSAGES: Record<WorkforceWorkdayCloseConflictCode, string> = {
  WORKFORCE_WORKDAY_CLOSE_NOT_LEFT_OPEN: "Only a shift left open for more than 16 hours can be closed by a manager",
  WORKFORCE_WORKDAY_CLOSE_FINISH_OUT_OF_RANGE: "The finish must be after the shift's last event and not in the future",
  WORKFORCE_WORKDAY_CLOSE_VERSION_CONFLICT: "Workday changed since it was opened for closing",
  WORKFORCE_WORKDAY_CLOSE_IDEMPOTENCY_MISMATCH: "operationId was already used for a different workday event",
  WORKFORCE_WORKDAY_CLOSE_TIMESHEET_APPROVED: "An approved timesheet already covers this workday",
  WORKFORCE_WORKDAY_CLOSE_CORRECTION_PENDING: "A time-correction request for this workday is still pending",
  WORKFORCE_WORKDAY_CLOSE_HISTORY_INVALID: "Workday history does not allow closing",
}

/**
 * Closes a shift another employee left open, for a manager in their scope.
 *
 * In one transaction: a FINISH journal event under the reserved
 * `close-left-open:` key at the manager's chosen instant (its note is the
 * reason), the projection the extended journal replays to, the employee off
 * the live map, and a WORKDAY_CLOSE_LEFT_OPEN audit record with the manager,
 * the before/after facts and the suggested finish they started from. The
 * completed-workday guard needs no exception: the row leaves STARTED/PAUSED.
 * A wrong finish is then fixed like any closed day, by a direct correction.
 */
export async function closeLeftOpenWorkforceWorkday(
  context: WorkforceWorkdayCloseContext,
): Promise<WorkforceWorkdayCloseResult> {
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
  const finishedAt = new Date(input.finishedAt)
  const requestHash = workforceWorkdayCloseRequestHash({ workdayId, actorUserId: userId, input })
  const clientEventId = workforceWorkdayCloseEventKey(input.operationId)
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-workday-close:${organizationId}:${input.operationId}`}))`
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
      if (!workday) throw new WorkdayCloseProblem({ kind: "not_found" })
      if (isWorkforceWorkdayOwnDay({ actor, userId, agentId: initial.agentId, agentUserId: workday.agent.userId })) {
        return { kind: "forbidden" as const }
      }
      const beforeWorkday = workforceWorkdayCorrectionFacts(workday)

      if (existing) {
        if (existing.type !== "FINISH" || existing.workdayId !== workdayId || existing.requestHash !== requestHash) {
          throw closeConflict(
            "WORKFORCE_WORKDAY_CLOSE_IDEMPOTENCY_MISMATCH",
            CLOSE_REFUSAL_MESSAGES.WORKFORCE_WORKDAY_CLOSE_IDEMPOTENCY_MISMATCH,
          )
        }
        return { kind: "success" as const, data: { eventId: existing.id, workday: beforeWorkday }, idempotent: true }
      }

      const stateConflict = workforceWorkdayCloseStateConflict(beforeWorkday, now)
      if (stateConflict) throw closeConflict(stateConflict, CLOSE_REFUSAL_MESSAGES[stateConflict], beforeWorkday)
      if (workday.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw closeConflict(
          "WORKFORCE_WORKDAY_CLOSE_VERSION_CONFLICT",
          CLOSE_REFUSAL_MESSAGES.WORKFORCE_WORKDAY_CLOSE_VERSION_CONFLICT,
          beforeWorkday,
        )
      }

      const [events, corrections, blockers, traces] = await Promise.all([
        readWorkforceWorkdayJournal(tx, workdayScope),
        readWorkforceWorkdayReplayCorrections(tx, workdayScope),
        readWorkforceWorkdayReopenBlockers(tx, { ...workdayScope, workDate: workday.workDate }),
        readWorkforceWorkdayCloseTraces(tx, { ...workdayScope, startedAt: workday.startedAt, now }),
      ])
      if (blockers.approvedTimesheet) {
        throw closeConflict("WORKFORCE_WORKDAY_CLOSE_TIMESHEET_APPROVED", CLOSE_REFUSAL_MESSAGES.WORKFORCE_WORKDAY_CLOSE_TIMESHEET_APPROVED, beforeWorkday)
      }
      if (blockers.pendingCorrectionRequest) {
        throw closeConflict("WORKFORCE_WORKDAY_CLOSE_CORRECTION_PENDING", CLOSE_REFUSAL_MESSAGES.WORKFORCE_WORKDAY_CLOSE_CORRECTION_PENDING, beforeWorkday)
      }
      const lastEvent = events.at(-1)
      if (!lastEvent) {
        throw closeConflict("WORKFORCE_WORKDAY_CLOSE_HISTORY_INVALID", "workday is missing START", beforeWorkday)
      }
      if (!workforceWorkdayCloseFinishInRange({ finishedAt, lastEventAt: lastEvent.occurredAt, now })) {
        throw closeConflict(
          "WORKFORCE_WORKDAY_CLOSE_FINISH_OUT_OF_RANGE",
          CLOSE_REFUSAL_MESSAGES.WORKFORCE_WORKDAY_CLOSE_FINISH_OUT_OF_RANGE,
          beforeWorkday,
        )
      }
      const replay = workforceWorkdayCloseReplay({
        workdayId,
        journal: events.map(workforceWorkdayEventFact),
        corrections,
        before: beforeWorkday,
        finishedAt,
        appliedAt: now,
        clientEventId,
      })
      if ("problem" in replay) throw closeConflict("WORKFORCE_WORKDAY_CLOSE_HISTORY_INVALID", replay.problem, beforeWorkday)
      const afterWorkday = replay.after
      const suggestedFinishAt = workforceWorkdayCloseSuggestedFinish({ lastEventAt: lastEvent.occurredAt, traces, now })

      const event = await tx.mtmAgentWorkdayEvent.create({
        select: { id: true },
        data: {
          organizationId,
          agentId: initial.agentId,
          workdayId,
          clientEventId,
          type: "FINISH",
          // The manager's judgement of when the work ended; the moment they
          // made it is the server receipt below.
          occurredAt: finishedAt,
          claimedAt: finishedAt,
          capturedAt: finishedAt,
          queuedAt: null,
          serverReceivedAt: now,
          appliedAt: now,
          schemaVersion: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
          requestHash,
          attendanceReviewState: "NOT_REQUIRED",
          attendanceReviewReasonCode: null,
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
          completedAt: new Date(afterWorkday.completedAt ?? finishedAt.toISOString()),
          totalPausedSeconds: afterWorkday.totalPausedSeconds,
        },
      })
      await tx.mtmAgent.updateMany({
        where: { id: initial.agentId, organizationId },
        data: { isOnline: false },
      })
      await writeWorkforceWorkdayCloseAuditInTransaction(tx, {
        scope,
        eventId: event.id,
        actorUserId: userId,
        operationId: input.operationId,
        reason: input.reason,
        authorizationSource,
        suggestedFinishAt: suggestedFinishAt.toISOString(),
        beforeWorkday,
        afterWorkday,
        requestMetadata: audit,
      })

      return { kind: "success" as const, data: { eventId: event.id, workday: afterWorkday }, idempotent: false }
    })
  } catch (error) {
    if (error instanceof WorkdayCloseProblem) return error.result
    throw error
  }
}
