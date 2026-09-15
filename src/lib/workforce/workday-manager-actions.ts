import type { Prisma } from "@prisma/client"
import type { WorkforceActor } from "@/lib/workforce/actor"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { workforceWorkdayEventFact } from "@/lib/workforce/workday-facts-replay"
import {
  authorizeWorkforceWorkdayManagerAction,
  isWorkforceWorkdayOwnDay,
  readWorkforceWorkdayJournal,
  readWorkforceWorkdayReopenBlockers,
  workforceReopenWorkdaySelect,
  workforceWorkdayReopenBlockerConflict,
  workforceWorkdayReopenEventKey,
  workforceWorkdayReopenHistoryProblem,
  workforceWorkdayReopenStateConflict,
  type WorkforceWorkdayScope,
} from "@/lib/workforce/workday-reopen"
import {
  findWorkforceWorkdayReopenLedgerRow,
  readWorkforceWorkdayReplayCorrections,
  workforceWorkdayReopenUndoEventKey,
  workforceWorkdayReopenUndoHistoryProblem,
  workforceWorkdayReopenUndoStateConflict,
  workforceWorkdayUndoableReopenEvent,
} from "@/lib/workforce/workday-reopen-undo"
import type {
  WorkforceWorkdayManagerAction,
  WorkforceWorkdayManagerActionBlockedReason,
  WorkforceWorkdayManagerActionDenialCode,
  WorkforceWorkdayManagerActions,
} from "@/lib/workforce/workday-reopen-contract"

export type WorkforceWorkdayManagerActionsDb = Pick<
  Prisma.TransactionClient,
  | "organization"
  | "workforceAccessGrant"
  | "mtmAgentWorkday"
  | "mtmAgentWorkdayEvent"
  | "workforceTimesheetApproval"
  | "mtmHrmRequest"
  | "workforceTimeCorrection"
  | "workforceWorkdayReopen"
>

/**
 * A preview never writes, so its pending events need no real operation id;
 * replay only reads the reserved prefix of the key.
 */
const PREVIEW_OPERATION_ID = "operational-week-preview"

type ActionWorkday = { id: string; updatedAt: Date }

function refused(
  workday: ActionWorkday | null,
  blockedReason: WorkforceWorkdayManagerActionBlockedReason,
): WorkforceWorkdayManagerAction {
  return {
    allowed: false,
    workdayId: workday?.id ?? null,
    updatedAt: workday?.updatedAt.toISOString() ?? null,
    blockedReason,
  }
}

function permitted(workday: ActionWorkday): WorkforceWorkdayManagerAction {
  return {
    allowed: true,
    workdayId: workday.id,
    updatedAt: workday.updatedAt.toISOString(),
    blockedReason: null,
  }
}

/**
 * Tells a manager, before they click, whether they may reopen the selected
 * employee's finished workday today or undo that reopen — and, when not, the
 * code the endpoint would answer with.
 *
 * It evaluates the reopen and undo services' own predicates, without their
 * locks and writes. Facts that belong to the day come first (a running shift
 * is simply "not finished", not "forbidden"), then the manager's authority,
 * then what else keeps the day closed. The services decide again under their
 * locks, so an answer that went stale in between is refused there with the
 * same code.
 *
 * Returns null for the employee's own day: there is nothing a manager could do
 * on it.
 */
export async function resolveWorkforceWorkdayManagerActions(
  db: WorkforceWorkdayManagerActionsDb,
  params: {
    organizationId: string
    /** The viewing principal and its Workforce actor. */
    userId: string
    actor: WorkforceActor | null
    /**
     * Whether the principal passes the endpoints' session boundary (a browser
     * session whose CRM role has Workforce write).
     */
    sessionPermitted: boolean
    agentId: string
    /** The employee's linked user, when one exists. */
    agentUserId: string | null
    /** The tenant-local date key the rest of the response uses as today. */
    today: string
    now: Date
  },
): Promise<WorkforceWorkdayManagerActions | null> {
  const { organizationId, userId, actor, agentId, today, now } = params
  if (isWorkforceWorkdayOwnDay({ actor, userId, agentId, agentUserId: params.agentUserId })) return null

  const workday = await db.mtmAgentWorkday.findFirst({
    where: { organizationId, agentId, workDate: new Date(`${today}T00:00:00.000Z`) },
    select: workforceReopenWorkdaySelect,
  })
  if (!workday) {
    return {
      reopen: refused(null, "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED"),
      undoReopen: refused(null, "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED"),
    }
  }
  if (isWorkforceWorkdayOwnDay({ actor, userId, agentId, agentUserId: workday.agent.userId })) return null

  const facts = workforceWorkdayCorrectionFacts(workday)
  const scope: WorkforceWorkdayScope = { organizationId, agentId, workdayId: workday.id }
  const reopenState = workforceWorkdayReopenStateConflict(facts, today)
  const undoState = workforceWorkdayReopenUndoStateConflict(facts, today)

  async function managerDenial(): Promise<WorkforceWorkdayManagerActionDenialCode | null> {
    if (!params.sessionPermitted) return "WORKFORCE_SESSION_PERMISSION_REQUIRED"
    const authority = await authorizeWorkforceWorkdayManagerAction(db, { organizationId, userId, actor, agentId })
    return authority ? null : "WORKFORCE_SCOPE_DENIED"
  }

  // Today's finished day: the reopen may apply, the undo cannot.
  const finishedAt = workday.completedAt
  if (!reopenState && finishedAt) {
    const undoReopen = refused(workday, undoState ?? "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED")
    const denial = await managerDenial()
    if (denial) return { reopen: refused(workday, denial), undoReopen }
    const [blockers, events] = await Promise.all([
      readWorkforceWorkdayReopenBlockers(db, { ...scope, workDate: workday.workDate }),
      readWorkforceWorkdayJournal(db, scope),
    ])
    const blocked = workforceWorkdayReopenBlockerConflict(blockers)
      ?? (workforceWorkdayReopenHistoryProblem({
        workdayId: workday.id,
        journal: events.map(workforceWorkdayEventFact),
        before: facts,
        finishedAt,
        appliedAt: now,
        clientEventId: workforceWorkdayReopenEventKey(PREVIEW_OPERATION_ID),
      }) ? "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID" : null)
    return { reopen: blocked ? refused(workday, blocked) : permitted(workday), undoReopen }
  }

  // Today's paused day: only a manager's reopen the employee has not acted on
  // can be undone. An ordinary break stops here, before any authority read.
  const reopen = refused(workday, reopenState ?? "WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED")
  const pauseStartedAt = workday.pausedAt
  if (undoState || !pauseStartedAt) {
    return { reopen, undoReopen: refused(workday, undoState ?? "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED") }
  }
  const events = await readWorkforceWorkdayJournal(db, scope)
  const reopenEvent = workforceWorkdayUndoableReopenEvent(events, pauseStartedAt)
  if (!reopenEvent) return { reopen, undoReopen: refused(workday, "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED") }
  const denial = await managerDenial()
  if (denial) return { reopen, undoReopen: refused(workday, denial) }
  const [ledgerRow, corrections] = await Promise.all([
    findWorkforceWorkdayReopenLedgerRow(db, { ...scope, eventId: reopenEvent.id }),
    readWorkforceWorkdayReplayCorrections(db, scope),
  ])
  const blocked = !ledgerRow
    ? "WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED"
    : workforceWorkdayReopenUndoHistoryProblem({
      workdayId: workday.id,
      journal: events.map(workforceWorkdayEventFact),
      corrections,
      before: facts,
      pauseStartedAt,
      appliedAt: now,
      clientEventId: workforceWorkdayReopenUndoEventKey(PREVIEW_OPERATION_ID),
    })
      ? "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID"
      : null
  return { reopen, undoReopen: blocked ? refused(workday, blocked) : permitted(workday) }
}
