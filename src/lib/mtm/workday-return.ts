import { enforceAttendanceInstallationApproval } from "@/lib/mtm/attendance-installation-policy"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { lockAttendanceRequests, requireAttendanceSelf } from "@/lib/mtm/attendance-self-access"
import {
  applyMtmWorkdayEvent,
  lockMtmWorkdayTransitions,
  MTM_WORKDAY_REOPEN_EVENT_KEY_PREFIX,
  WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION,
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import {
  workforceWorkdayCorrectionFacts,
  type WorkforceWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-correction-facts"
import { workforceWorkdayEventFact } from "@/lib/workforce/workday-facts-replay"
import {
  readWorkforceWorkdayJournal,
  readWorkforceWorkdayReopenBlockers,
  workforceReopenedWorkdayFacts,
  workforceReopenWorkdaySelect,
  workforceTenantToday,
  workforceWorkdayReopenBlockerConflict,
  workforceWorkdayReopenHistoryProblem,
  workforceWorkdayReopenStateConflict,
} from "@/lib/workforce/workday-reopen"

/**
 * An employee returns to the workday they closed earlier the same day.
 *
 * Owner, 2026-10-13, having closed a day at 10:56 and found no way back:
 * «думаю, ограничение не имеет смысла, это ничего не предотвращает», and of the
 * one condition proposed to him: «рекомендацию по ограничению в тот же
 * календарный день принимаю». The rule it replaces — «закрытый день не
 * переоткрывается» — stopped only people who closed the day by mistake or left
 * and came back; whoever wants to be out of sight has «Перерыв».
 *
 * What is kept from the manager's reopen (2026-09-15), which this is the
 * employee's own form of: the closure and the return both stay in the journal;
 * the time between them is never worked time (the day is paused from its
 * finish, and the return resumes it); one workday per date. A day of another
 * date is not returned to — yesterday changes only through a time-correction
 * request, otherwise hours could be added after the fact.
 *
 * The database lets a completed workday leave COMPLETED in one way only: a row
 * of `workforce_workday_reopens` written in the same transaction. So this
 * writes that ledger, with `source = "EMPLOYEE"`, and then resumes the day
 * through the ordinary state machine.
 */

/** The ledger wants a reason; the employee is asked for none — returning is the reason. */
export const MTM_WORKDAY_RETURN_REASON = "The employee returned to the workday closed earlier the same day"

export const MTM_WORKDAY_RETURN_CONFLICT = {
  /** The day is not closed: there is nothing to return to (the app refreshes and shows it open). */
  NOT_COMPLETED: "MTM_WORKDAY_RETURN_NOT_COMPLETED",
  /** The day is of another date: it changes through a time-correction request. */
  NOT_TODAY: "MTM_WORKDAY_RETURN_NOT_TODAY",
  /** The day's times were corrected, are being corrected, or its timesheet is approved. */
  LOCKED: "MTM_WORKDAY_RETURN_LOCKED",
  /** The journal does not reproduce the day as it stands; nothing is built on top of that. */
  HISTORY_INVALID: "MTM_WORKDAY_RETURN_HISTORY_INVALID",
  /** The same operation id came with another workday. */
  IDEMPOTENCY_MISMATCH: "MTM_WORKDAY_RETURN_IDEMPOTENCY_MISMATCH",
} as const

export type MtmWorkdayReturnConflictCode = (typeof MTM_WORKDAY_RETURN_CONFLICT)[keyof typeof MTM_WORKDAY_RETURN_CONFLICT]

export type MtmWorkdayReturnResult =
  | { kind: "success"; workday: WorkforceWorkdayCorrectionFacts; idempotent: boolean }
  | { kind: "not_found" }
  | { kind: "conflict"; code: MtmWorkdayReturnConflictCode; workday?: WorkforceWorkdayCorrectionFacts }

class ReturnRefused extends Error {
  constructor(readonly result: Exclude<MtmWorkdayReturnResult, { kind: "success" }>) {
    super(result.kind)
  }
}

function refuse(code: MtmWorkdayReturnConflictCode, workday?: WorkforceWorkdayCorrectionFacts): ReturnRefused {
  return new ReturnRefused({ kind: "conflict", code, ...(workday ? { workday } : {}) })
}

/** Binds an operation id to the employee and the day it returned. */
export function mtmWorkdayReturnRequestHash(params: { agentId: string; workdayId: string; operationId: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, action: "RETURN", agentId: params.agentId, workdayId: params.workdayId, operationId: params.operationId }))
    .digest("hex")
}

export async function returnOwnMtmWorkday(context: {
  organizationId: string
  /** The employee, as authenticated: only their own day is looked for. */
  agentId: string
  workdayId: string
  operationId: string
  /** Internal route context for the opt-in office path; never taken from body. */
  attendanceRole?: string
  installationId?: string | null
  /** The server clock; injectable only so «today» is deterministic in tests. */
  now?: Date
}): Promise<MtmWorkdayReturnResult> {
  const { organizationId, agentId, workdayId, operationId } = context
  const now = context.now ?? new Date()
  const scope = { organizationId, agentId, workdayId }
  const requestHash = mtmWorkdayReturnRequestHash({ agentId, workdayId, operationId })
  const today = await workforceTenantToday(organizationId, now)
  const reopenEventKey = `${MTM_WORKDAY_REOPEN_EVENT_KEY_PREFIX}${operationId}`

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The workday table keeps timestamps without a zone; the guard compares
      // them with the ledger's UTC facts.
      await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
      // Two sendings of one operation: the second waits and finds the first.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-workday-reopen:${organizationId}:${operationId}`}))`
      await lockMtmWorkdayTransitions(tx, { organizationId, agentId })
      if (context.attendanceRole) {
        const self={organizationId,agentId,role:context.attendanceRole}
        await lockAttendanceRequests(tx,self)
        await requireAttendanceSelf(tx,self,"attendanceWorkday")
      }

      const workday = await tx.mtmAgentWorkday.findFirst({
        where: { id: workdayId, organizationId, agentId },
        select: workforceReopenWorkdaySelect,
      })
      if (!workday) throw new ReturnRefused({ kind: "not_found" })
      const before = workforceWorkdayCorrectionFacts(workday)

      const existing = await tx.workforceWorkdayReopen.findFirst({
        where: { organizationId, operationId },
        select: { workdayId: true, agentId: true, source: true, requestHash: true },
      })
      if (existing) {
        if (existing.workdayId !== workdayId || existing.agentId !== agentId || existing.source !== "EMPLOYEE" || existing.requestHash !== requestHash) {
          throw refuse(MTM_WORKDAY_RETURN_CONFLICT.IDEMPOTENCY_MISMATCH)
        }
        // Acknowledged once more, never applied twice; the day is reported as it stands now.
        return { kind: "success" as const, workday: before, idempotent: true }
      }

      await enforceAttendanceInstallationApproval(tx, { organizationId, agentId }, context.installationId)

      const stateConflict = workforceWorkdayReopenStateConflict(before, today)
      const finishedAt = workday.completedAt
      if (stateConflict === "WORKFORCE_WORKDAY_REOPEN_NOT_TODAY") throw refuse(MTM_WORKDAY_RETURN_CONFLICT.NOT_TODAY, before)
      if (stateConflict || !finishedAt) throw refuse(MTM_WORKDAY_RETURN_CONFLICT.NOT_COMPLETED, before)

      const [blockers, events, eventKeyOwner] = await Promise.all([
        readWorkforceWorkdayReopenBlockers(tx, { ...scope, workDate: workday.workDate }),
        readWorkforceWorkdayJournal(tx, scope),
        tx.mtmAgentWorkdayEvent.findFirst({ where: { organizationId, agentId, clientEventId: reopenEventKey }, select: { id: true } }),
      ])
      if (workforceWorkdayReopenBlockerConflict(blockers)) throw refuse(MTM_WORKDAY_RETURN_CONFLICT.LOCKED, before)
      if (eventKeyOwner) throw refuse(MTM_WORKDAY_RETURN_CONFLICT.IDEMPOTENCY_MISMATCH)
      const historyProblem = workforceWorkdayReopenHistoryProblem({
        workdayId,
        journal: events.map(workforceWorkdayEventFact),
        before,
        finishedAt,
        appliedAt: now,
        clientEventId: reopenEventKey,
      })
      if (historyProblem) throw refuse(MTM_WORKDAY_RETURN_CONFLICT.HISTORY_INVALID, before)

      // Journal first: the ledger row names its REOPEN event, and the guard of
      // completed workdays accepts the change only against that ledger row.
      const reopenEvent = await tx.mtmAgentWorkdayEvent.create({
        select: { id: true },
        data: {
          organizationId,
          agentId,
          workdayId,
          clientEventId: reopenEventKey,
          type: "REOPEN",
          // Recorded at the finish it reopens, so the pause runs from there;
          // when the employee really came back is the server time beside it.
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
          note: MTM_WORKDAY_RETURN_REASON,
        },
      })
      const ledger = await tx.workforceWorkdayReopen.create({
        select: { id: true },
        data: {
          organizationId,
          agentId,
          workdayId,
          eventId: reopenEvent.id,
          operationId,
          requestHash,
          source: "EMPLOYEE",
          // The employee's own CRM user when the card has one; most field cards have none.
          actorUserId: workday.agent.userId ?? null,
          reason: MTM_WORKDAY_RETURN_REASON,
          beforeFacts: before,
          afterFacts: workforceReopenedWorkdayFacts(before),
          occurredAt: now,
        },
      })
      // Transaction-local: it cannot leak to another request on the same connection.
      await tx.$executeRaw`SELECT set_config('app.workforce_reopen_id', ${ledger.id}, true)`
      await tx.mtmAgentWorkday.update({
        where: { id: workdayId },
        data: { status: "PAUSED", pausedAt: finishedAt, completedAt: null },
      })

      // The return itself: the ordinary RESUME, at the server's clock — the
      // request is online by definition, and the phone's clock is not asked.
      // A finish stamped by a phone running ahead may lie a few minutes in the
      // server's future; the day is not resumed before it was finished.
      const resumedAt = new Date(Math.max(now.getTime(), finishedAt.getTime()))
      const resumed = await applyMtmWorkdayEvent(tx, { organizationId, agentId }, {
        action: "RESUME",
        workdayId,
        clientEventId: `return:${operationId}`,
        occurredAt: resumedAt,
        claimedAt: resumedAt,
        capturedAt: resumedAt,
        queuedAt: null,
        serverReceivedAt: now,
        schemaVersion: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
        attendanceReview: { state: "NOT_REQUIRED", reasonCode: null, policyVersion: WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION, claimAgeSeconds: 0 },
        workDateKey: before.workDate,
        latitude: null,
        longitude: null,
        accuracy: null,
        note: null,
      })
      // Whatever refuses the resume refuses the whole return: nobody is left
      // with a day reopened and not resumed.
      if (resumed.status !== "ok") throw refuse(MTM_WORKDAY_RETURN_CONFLICT.HISTORY_INVALID, before)

      const after = await tx.mtmAgentWorkday.findFirstOrThrow({
        where: { id: workdayId, organizationId, agentId },
        select: workforceReopenWorkdaySelect,
      })
      return { kind: "success" as const, workday: workforceWorkdayCorrectionFacts(after), idempotent: false }
    })
  } catch (error) {
    if (error instanceof ReturnRefused) return error.result
    throw error
  }
}
