import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import {
  lockMtmWorkdayTransitions,
  MTM_WORKDAY_REOPEN_EVENT_KEY_PREFIX,
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
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
  WORKFORCE_WORKDAY_JOURNAL_ORDER,
  WORKFORCE_WORKDAY_JOURNAL_SELECT,
  workforceReplayMatchesWorkdayCorrectionFacts,
  workforceWorkdayEventFact,
  WorkforceWorkdayFactsReplayError,
  type WorkforceWorkdayEventFact,
} from "@/lib/workforce/workday-facts-replay"
import {
  WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH,
  WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH,
  type WorkforceWorkdayReopenConflictCode,
} from "@/lib/workforce/workday-reopen-contract"

export type { WorkforceWorkdayReopenConflictCode } from "@/lib/workforce/workday-reopen-contract"

/**
 * A manager reopens the employee's finished shift for today, or undoes that
 * reopen. The body carries no times: the day's own facts determine them.
 */
export const WorkforceWorkdayReopenSchema = z.object({
  operationId: z.string().trim().min(8).max(128),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim()
    .min(WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH)
    .max(WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH),
}).strict()

export type WorkforceWorkdayReopenInput = z.infer<typeof WorkforceWorkdayReopenSchema>

/** Request context shared by the reopen and undo services. */
export type WorkforceWorkdayReopenContext = {
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

export const workforceReopenWorkdaySelect = {
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

/** The employee and day a reopen, an undo or their availability reads. */
export type WorkforceWorkdayScope = {
  organizationId: string
  agentId: string
  workdayId: string
}

/** Binds a reopen or undo operation id to its actor, target and exact body. */
export function workforceWorkdayReopenRequestHash(params: {
  action: "REOPEN" | "REOPEN_UNDO"
  workdayId: string
  actorUserId: string
  input: WorkforceWorkdayReopenInput
}): string {
  const payload = {
    version: 1,
    action: params.action,
    workdayId: params.workdayId,
    actorUserId: params.actorUserId,
    operationId: params.input.operationId,
    expectedUpdatedAt: new Date(params.input.expectedUpdatedAt).toISOString(),
    reason: params.input.reason,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

/** The journal key of the REOPEN event an operation writes. */
export function workforceWorkdayReopenEventKey(operationId: string): string {
  return `${MTM_WORKDAY_REOPEN_EVENT_KEY_PREFIX}${operationId}`
}

/** Today's date key in the tenant timezone: the only day a manager may touch. */
export async function workforceTenantToday(organizationId: string, now: Date): Promise<string> {
  const settings = await getMtmSettings(organizationId)
  return currentDateKey(now, isValidTimezone(settings.timezone) ? settings.timezone : "UTC")
}

/**
 * Reopening and undoing are supervisor actions on someone else's day. Web
 * admins resolve without an agentId, so the target employee's linked user is
 * compared too.
 */
export function isWorkforceWorkdayOwnDay(params: {
  actor: Pick<WorkforceActor, "agentId"> | null
  userId: string
  agentId: string
  agentUserId: string | null
}): boolean {
  return params.actor?.agentId === params.agentId || params.agentUserId === params.userId
}

/** The client surface the manager authority reads: a transaction or the tenant client. */
export type WorkforceWorkdayManagerAuthorityDb = Pick<
  Prisma.TransactionClient,
  "organization" | "workforceAccessGrant"
>

/**
 * Exactly the authority of a direct manager time correction: the legacy CRM
 * manager scope before C7 cutover, a TIME_CORRECT grant after it. Returns the
 * audit label of the authority used, or null when the principal is refused.
 * The caller still refuses the employee's own day separately.
 */
export async function authorizeWorkforceWorkdayManagerAction(
  db: WorkforceWorkdayManagerAuthorityDb,
  params: { organizationId: string; userId: string; actor: WorkforceActor | null; agentId: string },
): Promise<string | null> {
  const organization = await db.organization.findUnique({
    where: { id: params.organizationId },
    select: { features: true },
  })
  if (!workforceGranularAccessEnabled(organization?.features)) {
    const actor = params.actor
    if (!actor || actor.role === "AGENT" || !isAgentInWorkforceScope(actor, params.agentId)) return null
    return actor.role
  }
  const access = await decidePersistedWorkforceAccess({
    db: db as WorkforceAccessGrantReaderDb,
    organizationId: params.organizationId,
    principalUserId: params.userId,
    selfAgentId: null,
    permission: "TIME_CORRECT",
    resource: { organizationId: params.organizationId, agentId: params.agentId },
  })
  return access.allowed ? "WORKFORCE_GRANT" : null
}

export type WorkforceWorkdayReopenStateConflictCode = Extract<
  WorkforceWorkdayReopenConflictCode,
  "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED" | "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY"
>

/**
 * What the day's own facts say about a reopen: only a finished shift dated
 * today in the tenant's timezone can be reopened.
 */
export function workforceWorkdayReopenStateConflict(
  workday: Pick<WorkforceWorkdayCorrectionFacts, "status" | "completedAt" | "workDate">,
  today: string,
): WorkforceWorkdayReopenStateConflictCode | null {
  if (workday.status !== "COMPLETED" || !workday.completedAt) return "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED"
  if (workday.workDate !== today) return "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY"
  return null
}

export type WorkforceWorkdayReopenBlockersDb = Pick<
  Prisma.TransactionClient,
  "mtmAgentWorkday" | "workforceTimesheetApproval" | "mtmHrmRequest" | "workforceTimeCorrection"
>

/** Facts outside the workday row that keep a finished day closed. */
export type WorkforceWorkdayReopenBlockers = {
  /** One shift per day: the employee already holds another open workday. */
  otherOpenWorkday: boolean
  /** An approved timesheet already covers the day. */
  approvedTimesheet: boolean
  /** A time-correction request for the day still awaits a decision. */
  pendingCorrectionRequest: boolean
  /** A direct time correction already rewrote the day. */
  corrected: boolean
}

export async function readWorkforceWorkdayReopenBlockers(
  db: WorkforceWorkdayReopenBlockersDb,
  params: WorkforceWorkdayScope & { workDate: Date },
): Promise<WorkforceWorkdayReopenBlockers> {
  const { organizationId, agentId, workdayId, workDate } = params
  const [otherOpenWorkday, approval, pendingCorrection, corrections] = await Promise.all([
    db.mtmAgentWorkday.findFirst({
      where: {
        organizationId,
        agentId,
        status: { in: ["STARTED", "PAUSED"] },
        id: { not: workdayId },
      },
      select: { id: true },
    }),
    db.workforceTimesheetApproval.findFirst({
      where: {
        organizationId,
        agentId,
        periodStart: { lte: workDate },
        periodEnd: { gte: workDate },
      },
      select: { id: true },
    }),
    db.mtmHrmRequest.findFirst({
      where: {
        organizationId,
        agentId,
        type: "TIME_CORRECTION",
        status: "PENDING",
        correctionWorkdayId: workdayId,
      },
      select: { id: true },
    }),
    db.workforceTimeCorrection.findMany({
      where: { organizationId, agentId, workdayId },
      select: { id: true },
    }),
  ])
  return {
    otherOpenWorkday: Boolean(otherOpenWorkday),
    approvedTimesheet: Boolean(approval),
    pendingCorrectionRequest: Boolean(pendingCorrection),
    corrected: corrections.length > 0,
  }
}

export type WorkforceWorkdayReopenBlockerConflictCode = Extract<
  WorkforceWorkdayReopenConflictCode,
  | "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS"
  | "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED"
  | "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING"
  | "WORKFORCE_WORKDAY_REOPEN_CORRECTED"
>

/** The first blocker that refuses a reopen, in the service's order. */
export function workforceWorkdayReopenBlockerConflict(
  blockers: WorkforceWorkdayReopenBlockers,
): WorkforceWorkdayReopenBlockerConflictCode | null {
  if (blockers.otherOpenWorkday) return "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS"
  if (blockers.approvedTimesheet) return "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED"
  if (blockers.pendingCorrectionRequest) return "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING"
  // The correction ledger replays after the whole journal. A REOPEN after a
  // correction would split that chain, so corrected days stay closed.
  if (blockers.corrected) return "WORKFORCE_WORKDAY_REOPEN_CORRECTED"
  return null
}

const REOPEN_REFUSAL_MESSAGES: Record<
  WorkforceWorkdayReopenStateConflictCode | WorkforceWorkdayReopenBlockerConflictCode,
  string
> = {
  WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED: "Only a completed workday can be reopened",
  WORKFORCE_WORKDAY_REOPEN_NOT_TODAY: "Only today's workday can be reopened",
  WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS: "The employee already has another open workday",
  WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED: "An approved timesheet already covers this workday",
  WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING: "A time-correction request for this workday is still pending",
  WORKFORCE_WORKDAY_REOPEN_CORRECTED: "A corrected workday cannot be reopened",
}

/** The day's whole append-only journal, in replay order. */
export async function readWorkforceWorkdayJournal(
  db: Pick<Prisma.TransactionClient, "mtmAgentWorkdayEvent">,
  scope: WorkforceWorkdayScope,
) {
  return db.mtmAgentWorkdayEvent.findMany({
    where: { organizationId: scope.organizationId, agentId: scope.agentId, workdayId: scope.workdayId },
    orderBy: [...WORKFORCE_WORKDAY_JOURNAL_ORDER],
    select: WORKFORCE_WORKDAY_JOURNAL_SELECT,
  })
}

/**
 * The projection a reopen produces: PAUSED with `pausedAt` at the previous
 * finish and an unchanged closed-pause total, so the ordinary RESUME and
 * FINISH-while-paused transitions bank the gap as pause.
 */
export function workforceReopenedWorkdayFacts(
  before: WorkforceWorkdayCorrectionFacts,
): WorkforceWorkdayCorrectionFacts {
  return {
    ...before,
    status: "PAUSED",
    pausedAt: before.completedAt,
    completedAt: null,
  }
}

/**
 * Proves the immutable journal reproduces the finished row before a REOPEN
 * extends it, and that the extended journal reproduces exactly the reopened
 * row. Returns why it does not, or null.
 */
export function workforceWorkdayReopenHistoryProblem(params: {
  workdayId: string
  journal: readonly WorkforceWorkdayEventFact[]
  before: WorkforceWorkdayCorrectionFacts
  /** The finish being reopened: the REOPEN is recorded at that instant. */
  finishedAt: Date
  /** When the server applies the REOPEN. */
  appliedAt: Date
  clientEventId: string
}): string | null {
  const { workdayId, journal, before } = params
  try {
    const replayed = replayWorkforceWorkdayFacts({ workdayId, events: journal })
    if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, before)) {
      return "Immutable workday journal does not match its current projection"
    }
    const reopened = replayWorkforceWorkdayFacts({
      workdayId,
      events: [...journal, {
        id: "pending-workday-reopen",
        type: "REOPEN",
        occurredAt: params.finishedAt.toISOString(),
        appliedAt: params.appliedAt.toISOString(),
        clientEventId: params.clientEventId,
      }],
    })
    if (!workforceReplayMatchesWorkdayCorrectionFacts(reopened, workforceReopenedWorkdayFacts(before))) {
      return "Reopened workday journal does not reproduce the reopened projection"
    }
    return null
  } catch (error) {
    if (!(error instanceof WorkforceWorkdayFactsReplayError)) throw error
    return error.message
  }
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
 *
 * The refusals are the exported predicates above, which the operational week
 * also evaluates to tell a manager in advance whether the action is possible.
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
  if (isWorkforceWorkdayOwnDay({ actor, userId, agentId: initial.agentId, agentUserId: initial.agent.userId })) {
    return { kind: "forbidden" }
  }

  const expectedUpdatedAt = new Date(input.expectedUpdatedAt)
  const immutableRequestHash = workforceWorkdayReopenRequestHash({
    action: "REOPEN",
    workdayId,
    actorUserId: userId,
    input,
  })
  const today = await workforceTenantToday(organizationId, now)
  const clientEventId = workforceWorkdayReopenEventKey(input.operationId)
  const scope: WorkforceWorkdayScope = { organizationId, agentId: initial.agentId, workdayId }

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const authorizationSource = await authorizeWorkforceWorkdayManagerAction(tx, {
        organizationId,
        userId,
        actor,
        agentId: initial.agentId,
      })
      if (!authorizationSource) return { kind: "forbidden" as const }
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
          select: workforceReopenWorkdaySelect,
        })
        if (!current) throw new WorkdayReopenProblem({ kind: "not_found" })
        // Repeat the self check under the lock that returns the replay: an
        // employee linked to this user after the preflight gets no receipt.
        if (isWorkforceWorkdayOwnDay({ actor, userId, agentId: initial.agentId, agentUserId: current.agent.userId })) {
          return { kind: "forbidden" as const }
        }
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
        select: workforceReopenWorkdaySelect,
      })
      if (!workday) throw new WorkdayReopenProblem({ kind: "not_found" })
      if (isWorkforceWorkdayOwnDay({ actor, userId, agentId: initial.agentId, agentUserId: workday.agent.userId })) {
        return { kind: "forbidden" as const }
      }

      const beforeWorkday = workforceWorkdayCorrectionFacts(workday)
      const finishedAt = workday.completedAt
      const stateConflict = workforceWorkdayReopenStateConflict(beforeWorkday, today)
      if (stateConflict || !finishedAt) {
        const code = stateConflict ?? "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED"
        throw reopenConflict(code, REOPEN_REFUSAL_MESSAGES[code], beforeWorkday)
      }
      if (workday.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_VERSION_CONFLICT",
          "Workday changed since it was opened for reopening",
          beforeWorkday,
        )
      }

      const [blockers, events, eventKeyOwner] = await Promise.all([
        readWorkforceWorkdayReopenBlockers(tx, { ...scope, workDate: workday.workDate }),
        readWorkforceWorkdayJournal(tx, scope),
        tx.mtmAgentWorkdayEvent.findFirst({
          where: { organizationId, agentId: initial.agentId, clientEventId },
          select: { id: true },
        }),
      ])
      const blockerConflict = workforceWorkdayReopenBlockerConflict(blockers)
      if (blockerConflict) {
        throw reopenConflict(blockerConflict, REOPEN_REFUSAL_MESSAGES[blockerConflict], beforeWorkday)
      }
      if (eventKeyOwner) {
        throw reopenConflict(
          "WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH",
          "operationId was already used for a different workday event",
        )
      }

      const afterWorkday = workforceReopenedWorkdayFacts(beforeWorkday)
      const historyProblem = workforceWorkdayReopenHistoryProblem({
        workdayId,
        journal: events.map(workforceWorkdayEventFact),
        before: beforeWorkday,
        finishedAt,
        appliedAt: now,
        clientEventId,
      })
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
          // The pause starts at the recorded finish, whatever clock the phone
          // stamped it with (up to five minutes ahead of the server). Recording
          // the REOPEN at that instant keeps the journal ordered and lets the
          // employee's RESUME carry any time after the finish. The moment the
          // manager acted is the server receipt/application time below, and
          // the ledger row and audit record keep it too.
          occurredAt: finishedAt,
          claimedAt: finishedAt,
          capturedAt: finishedAt,
          // No client outbox ever held this server-produced fact.
          queuedAt: null,
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
          pausedAt: finishedAt,
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
        authorizationSource,
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
