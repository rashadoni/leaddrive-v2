import { randomUUID } from "node:crypto"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import type { Prisma } from "@prisma/client"
import { AttendanceCorrectionBasisSchema, AttendanceRequestDetailsSchema, AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { workforceWorkdayCorrectionFacts, type WorkforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import {
  replayWorkforceWorkdayFacts, workforceReplayMatchesWorkdayCorrectionFacts, workforceWorkdayEventFact,
  WORKFORCE_WORKDAY_JOURNAL_ORDER, WORKFORCE_WORKDAY_JOURNAL_SELECT, WorkforceWorkdayFactsReplayError,
} from "@/lib/workforce/workday-facts-replay"

const factsSelect = { id: true, workDate: true, status: true, startedAt: true, pausedAt: true, completedAt: true, totalPausedSeconds: true } as const
function conflict(code = "MTM_ATTENDANCE_CORRECTION_CHANGED"): never { throw new AttendanceRequestError(code) }
function sameFacts(a: WorkforceWorkdayCorrectionFacts, b: WorkforceWorkdayCorrectionFacts) {
  return a.id === b.id && a.workDate === b.workDate && a.status === b.status && a.startedAt === b.startedAt
    && a.completedAt === b.completedAt && a.pausedAt === b.pausedAt && a.totalPausedSeconds === b.totalPausedSeconds
}

/**
 * Called only inside the MTM decision transaction, after its write permission,
 * current tenant/employee scope and workday → request locks. Owns approval and
 * ledger/projection writes together; the caller must not pre-approve a request.
 * No phone event is created, including when the employee never marked START.
 */
export async function applyAttendanceTimeCorrectionInTransaction(tx: Prisma.TransactionClient, input: {
  organizationId: string; userId: string; requestId: string; expectedVersion: string
  decisionNote: string | null; now: Date
}): Promise<{ requestId: string; correctionId: string; workdayId: string; workday: WorkforceWorkdayCorrectionFacts; idempotent: boolean }> {
  const { organizationId, userId, requestId, now } = input
  const decisionNote = input.decisionNote?.trim() || null
  if (!Number.isFinite(now.getTime())) conflict("MTM_ATTENDANCE_CORRECTION_INVALID")
  await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
  const request = await tx.mtmHrmRequest.findFirst({ where: { id: requestId, organizationId }, select: {
    id: true, agentId: true, type: true, status: true, updatedAt: true, startDate: true, endDate: true,
    correctionWorkdayId: true, requestedStartAt: true, requestedEndAt: true, attendanceDetails: true,
    reason: true, decisionNote: true, decidedByUserId: true, decidedAt: true,
    agent: { select: { userId: true } },
  } })
  if (!request) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
  // An HR/admin actor may have no agentId; linked user identity still prevents
  // approving their own employee request.
  if (request.agent.userId === userId) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_SELF_APPROVAL", 403)
  const details = AttendanceRequestDetailsSchema.safeParse(request.attendanceDetails)
  if (request.type !== "TIME_CORRECTION" || !details.success || details.data.kind !== "TIME_CORRECTION" || !details.data.correctionBasis) {
    conflict("MTM_ATTENDANCE_CORRECTION_INVALID")
  }
  const basis = details.data.correctionBasis
  const workDate = request.startDate.toISOString().slice(0, 10)
  const start = request.requestedStartAt
  const end = request.requestedEndAt
  const endDate = request.endDate.toISOString().slice(0, 10)
  const overnight = endDate === addDateKeyDays(workDate, 1)
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end > now
    || (endDate !== workDate && !overnight)
    || (overnight && end.getTime() - start.getTime() > 86_400_000)
    || (basis.kind === "MISSING" ? basis.workDate : basis.facts.workDate) !== workDate) {
    conflict("MTM_ATTENDANCE_CORRECTION_INVALID")
  }
  // The employee's explicit end date and frozen zone must describe the same
  // proposed UTC interval. Never infer a rollover from a smaller end clock.
  try {
    if (!isValidTimezone(details.data.timezone) || !details.data.startTime || !details.data.endTime
      || (overnight && details.data.endTime > details.data.startTime)
      || localDateTimeToUnambiguousUtc(`${workDate}T${details.data.startTime}`, details.data.timezone).getTime() !== start.getTime()
      || localDateTimeToUnambiguousUtc(`${endDate}T${details.data.endTime}`, details.data.timezone).getTime() !== end.getTime()) conflict("MTM_ATTENDANCE_CORRECTION_INVALID")
  } catch { conflict("MTM_ATTENDANCE_CORRECTION_INVALID") }
  const ledger = await tx.workforceTimeCorrection.findFirst({ where: { organizationId, requestId },
    select: { id: true, workdayId: true, agentId: true, actorUserId: true, source: true, occurredAt: true, beforeFacts: true, afterFacts: true } })
  if (request.status !== "PENDING") {
    if (request.status !== "APPROVED" || request.decidedByUserId !== userId || request.decisionNote !== decisionNote
      || !ledger || ledger.source !== "REQUEST_APPROVAL" || ledger.actorUserId !== userId || ledger.agentId !== request.agentId
      || ledger.workdayId !== request.correctionWorkdayId || ledger.occurredAt.getTime() !== request.decidedAt?.getTime()) conflict("MTM_ATTENDANCE_REQUEST_ALREADY_DECIDED")
    const parsedAfter = AttendanceCorrectionBasisSchema.safeParse({ kind: "WORKDAY", facts: ledger.afterFacts })
    const parsedBefore = AttendanceCorrectionBasisSchema.safeParse(basis.kind === "MISSING" ? ledger.beforeFacts : { kind: "WORKDAY", facts: ledger.beforeFacts })
    if (!parsedAfter.success || parsedAfter.data.kind !== "WORKDAY" || !parsedBefore.success
      || (basis.kind === "MISSING" ? parsedBefore.data.kind !== "MISSING" || parsedBefore.data.workDate !== workDate
        : parsedBefore.data.kind !== "WORKDAY" || !sameFacts(parsedBefore.data.facts, basis.facts))) conflict()
    const after = parsedAfter.data.facts
    if (after.id !== ledger.workdayId || after.workDate !== workDate || after.status !== "COMPLETED"
      || after.startedAt !== start.toISOString() || after.completedAt !== end.toISOString() || after.pausedAt !== null) conflict()
    return { requestId, correctionId: ledger.id, workdayId: ledger.workdayId, workday: after, idempotent: true }
  }
  if (ledger || request.updatedAt.toISOString() !== input.expectedVersion) conflict("MTM_ATTENDANCE_REQUEST_CHANGED")
  const current = await tx.mtmAgentWorkday.findFirst({ where: { organizationId, agentId: request.agentId, workDate: request.startDate }, select: factsSelect })
  if (basis.kind === "MISSING" ? current !== null || request.correctionWorkdayId !== null
    : !current || current.id !== request.correctionWorkdayId || !sameFacts(workforceWorkdayCorrectionFacts(current), basis.facts)) conflict()
  const workdayId = current?.id ?? randomUUID()
  const before = current ? workforceWorkdayCorrectionFacts(current) : { kind: "MISSING" as const, workDate }
  const after = attendanceCorrectionAfterFacts({ workdayId, workDate, current, start, end })
  if (current && sameFacts(workforceWorkdayCorrectionFacts(current), after)) conflict("MTM_ATTENDANCE_CORRECTION_UNCHANGED")
  const [events, corrections] = current ? await Promise.all([
    tx.mtmAgentWorkdayEvent.findMany({ where: { organizationId, agentId: request.agentId, workdayId },
      orderBy: [...WORKFORCE_WORKDAY_JOURNAL_ORDER], select: WORKFORCE_WORKDAY_JOURNAL_SELECT }),
    tx.workforceTimeCorrection.findMany({ where: { organizationId, agentId: request.agentId, workdayId }, select: { id: true, beforeFacts: true, afterFacts: true } }),
  ]) : [[], []]
  const correctionId = randomUUID()
  try {
    if (current && !workforceReplayMatchesWorkdayCorrectionFacts(replayWorkforceWorkdayFacts({ workdayId, events: events.map(workforceWorkdayEventFact), corrections }), workforceWorkdayCorrectionFacts(current))) {
      throw new WorkforceWorkdayFactsReplayError("Current projection does not match the immutable history")
    }
    replayWorkforceWorkdayFacts({ workdayId, events: events.map(workforceWorkdayEventFact), corrections: [...corrections, { id: correctionId, beforeFacts: before, afterFacts: after }] })
  } catch (error) {
    if (error instanceof WorkforceWorkdayFactsReplayError) conflict("MTM_ATTENDANCE_CORRECTION_HISTORY_INVALID")
    throw error
  }
  if (!current) await tx.mtmAgentWorkday.create({ data: { id: workdayId, organizationId, agentId: request.agentId,
    workDate: request.startDate, status: "COMPLETED", startedAt: start, completedAt: end, pausedAt: null, totalPausedSeconds: 0 }, select: { id: true } })
  const approved = await tx.mtmHrmRequest.updateMany({ where: { id: requestId, organizationId, agentId: request.agentId, status: "PENDING", updatedAt: request.updatedAt },
    data: { status: "APPROVED", correctionWorkdayId: workdayId, decisionNote, decidedByUserId: userId, decidedAt: now } })
  if (approved.count !== 1) conflict("MTM_ATTENDANCE_REQUEST_CHANGED")
  await tx.workforceTimeCorrection.create({ data: { id: correctionId, organizationId, workdayId, agentId: request.agentId,
    requestId, source: "REQUEST_APPROVAL", operationId: `request-approval:${requestId}`, actorUserId: userId,
    reason: decisionNote || request.reason, beforeFacts: before, afterFacts: after, occurredAt: now }, select: { id: true } })
  if (current) {
    await tx.$executeRaw`SELECT set_config('app.workforce_correction_id', ${correctionId}, true)`
    await tx.mtmAgentWorkday.update({ where: { id: workdayId }, data: { status: "COMPLETED", startedAt: start,
      completedAt: end, pausedAt: null, totalPausedSeconds: after.totalPausedSeconds } })
  }
  await tx.mtmAuditLog.create({ data: { organizationId, agentId: request.agentId, action: "WORKFORCE_TIME_CORRECTION_APPLIED",
    entity: "workday", entityId: workdayId, metadataKind: "workforce_time_correction", oldData: { workday: before },
    newData: { workday: after, actorUserId: userId, requestId, correctionId, source: "REQUEST_APPROVAL" } } })
  return { requestId, correctionId, workdayId, workday: after, idempotent: false }
}

type CorrectionCurrent = { totalPausedSeconds: number; pausedAt: Date | null } | null

/** The facts an approved correction leaves the day in: one rule for the approval and for the probe below. */
export function attendanceCorrectionAfterFacts(input: { workdayId: string; workDate: string; current: CorrectionCurrent; start: Date; end: Date }): WorkforceWorkdayCorrectionFacts {
  const { workdayId, workDate, current, start, end } = input
  return {
    id: workdayId, workDate, status: "COMPLETED", startedAt: start.toISOString(), completedAt: end.toISOString(), pausedAt: null,
    totalPausedSeconds: (current?.totalPausedSeconds ?? 0) + (current?.pausedAt ? Math.floor((end.getTime() - current.pausedAt.getTime()) / 1000) : 0),
  }
}

/**
 * Would the day's journal take this correction? The same replay the approval
 * runs, asked when the employee submits. Owner's phone, 2026-10-18: «Günü
 * bağla» at 18:30 for a day whose journal had a return to work at 21:53 and a
 * break at 22:18 — no finish can precede the marks after it, so the request sat
 * PENDING where neither the manager nor the company's auto-approval could ever
 * approve it (MTM_ATTENDANCE_CORRECTION_HISTORY_INVALID at approval). Refusing
 * at submission tells the employee while they are still holding the phone.
 */
export async function attendanceCorrectionFitsJournal(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; agentId: string; workday: { id: string; workDate: Date; status: string; startedAt: Date; pausedAt: Date | null; completedAt: Date | null; totalPausedSeconds: number }; start: Date; end: Date },
): Promise<boolean> {
  const { organizationId, agentId, workday, start, end } = input
  const workDate = workday.workDate.toISOString().slice(0, 10)
  const before = workforceWorkdayCorrectionFacts(workday)
  const after = attendanceCorrectionAfterFacts({ workdayId: workday.id, workDate, current: workday, start, end })
  const [events, corrections] = await Promise.all([
    tx.mtmAgentWorkdayEvent.findMany({ where: { organizationId, agentId, workdayId: workday.id },
      orderBy: [...WORKFORCE_WORKDAY_JOURNAL_ORDER], select: WORKFORCE_WORKDAY_JOURNAL_SELECT }),
    tx.workforceTimeCorrection.findMany({ where: { organizationId, agentId, workdayId: workday.id }, select: { id: true, beforeFacts: true, afterFacts: true } }),
  ])
  try {
    replayWorkforceWorkdayFacts({ workdayId: workday.id, events: events.map(workforceWorkdayEventFact), corrections: [...corrections, { id: "submission-probe", beforeFacts: before, afterFacts: after }] })
    return true
  } catch (error) {
    if (error instanceof WorkforceWorkdayFactsReplayError) return false
    throw error
  }
}
