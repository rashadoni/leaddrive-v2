import { Prisma } from "@prisma/client"
import { z } from "zod"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { prisma } from "@/lib/prisma"
import { isAgentInWorkforceScope, type WorkforceActor } from "@/lib/workforce/actor"
import {
  evaluateWorkforceExceptionDraftLifecycle,
  WORKFORCE_EXCEPTION_DRAFT_TYPES,
  type WorkforceExceptionDraftStage,
  type WorkforceExceptionDraftType,
} from "@/lib/workforce/exception-policy-draft"
import { lockWorkforceExceptionDecisionStream } from "@/lib/workforce/exception-case-writer"
import {
  buildWorkforceTimesheetApproval,
  persistWorkforceTimesheetApproval,
  WorkforceTimesheetApprovalError,
  type WorkforceTimesheetApprovalRow,
} from "@/lib/workforce/timesheet-approval"
import {
  rehydrateWorkforceTimesheetDay,
  WorkforceTimesheetRehydrationError,
  type WorkforcePolicySnapshotForCalculation,
  type WorkforceShiftSnapshotForCalculation,
  type WorkforceTimesheetWorkday,
} from "@/lib/workforce/timesheet-rehydration"
import type {
  WorkforceTimeCorrectionReplayFact,
  WorkforceWorkdayEventFact,
} from "@/lib/workforce/workday-facts-replay"

const WorkforceDateKey = z.string().refine(isDateKey, "must be YYYY-MM-DD")

/**
 * The client requests only a person and a bounded period. It never supplies
 * calculated rows, hashes or a workday list; those are rebuilt under the same
 * per-employee fence used by every canonical workday writer.
 */
export const WorkforceTimesheetApprovalRequestSchema = z.object({
  agentId: z.string().trim().min(1).max(100),
  periodStart: WorkforceDateKey,
  periodEnd: WorkforceDateKey,
  correctionReason: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.periodEnd < value.periodStart) {
    context.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd must not be before periodStart" })
  }
  if (value.periodEnd > addDateKeyDays(value.periodStart, 92)) {
    context.addIssue({ code: "custom", path: ["periodEnd"], message: "period may cover at most 93 days" })
  }
})

export type WorkforceTimesheetApprovalRequest = z.infer<typeof WorkforceTimesheetApprovalRequestSchema>

export type WorkforceTimesheetApprovalBlocker = {
  workdayId?: string
  caseReference?: string
  workDate: string
  reason: "WORKDAY_NOT_FINAL" | "SNAPSHOT_MISSING" | "HISTORY_INVALID" | "UNRESOLVED_EXCEPTION"
  exceptionType?: WorkforceExceptionDraftType
  exceptionStage?: Exclude<WorkforceExceptionDraftStage, "RESOLVED"> | "DATA_INTEGRITY_REVIEW"
}

type WorkforceTimesheetApprovalAuditContext = {
  ipAddress?: string | null
  userAgent?: string | null
}

type WorkforceTimesheetApprovalContext = {
  organizationId: string
  userId: string
  actor: WorkforceActor
  input: WorkforceTimesheetApprovalRequest
  audit?: WorkforceTimesheetApprovalAuditContext
}

export type WorkforceTimesheetApprovalResult =
  | {
    kind: "success"
    data: {
      id: string
      revision: number
      recordKind: "APPROVAL" | "CORRECTION"
      periodStart: string
      periodEnd: string
      agentId: string
      rowsHash: string
      factsHash: string
      calculationVersion: number
    }
    idempotent: boolean
  }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "conflict"; code: string; message: string; blockers?: WorkforceTimesheetApprovalBlocker[] }

class WorkforceTimesheetApprovalProblem extends Error {
  constructor(readonly result: Exclude<WorkforceTimesheetApprovalResult, { kind: "success" } | { kind: "forbidden" }>) {
    super(result.kind === "conflict" ? result.message : "Workforce employee not found")
  }
}

type WorkforceWorkdayEventRecord = Omit<WorkforceWorkdayEventFact, "occurredAt"> & {
  workdayId: string
  occurredAt: Date
}

type WorkforceCorrectionRecord = WorkforceTimeCorrectionReplayFact & { workdayId: string }

function recordsByWorkday<T extends { workdayId: string }>(records: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const record of records) {
    const existing = result.get(record.workdayId)
    if (existing) existing.push(record)
    else result.set(record.workdayId, [record])
  }
  return result
}

function conflict(
  code: string,
  message: string,
  blockers?: WorkforceTimesheetApprovalBlocker[],
): WorkforceTimesheetApprovalProblem {
  return new WorkforceTimesheetApprovalProblem({
    kind: "conflict",
    code,
    message,
    ...(blockers?.length ? { blockers } : {}),
  })
}

const WORKFORCE_EXCEPTION_TYPE_SET = new Set<string>(WORKFORCE_EXCEPTION_DRAFT_TYPES)
const MAX_APPROVAL_EXCEPTION_CASES = 500
const MAX_APPROVAL_CASE_DECISIONS = 64

function approvalExceptionType(value: string): WorkforceExceptionDraftType | undefined {
  return WORKFORCE_EXCEPTION_TYPE_SET.has(value) ? value as WorkforceExceptionDraftType : undefined
}

/**
 * Rebuilds every existing workday in the requested employee/period scope.
 * A period becomes approval-ready only when every stored workday is closed,
 * snapshotted and replayable. The model intentionally does not infer missing
 * starts, leave or no-show calendar facts; those require their own explicit
 * lifecycle rather than silently becoming payable/approved zeros here.
 */
async function rebuildApprovalRows(
  tx: Prisma.TransactionClient,
  scope: { organizationId: string; agentId: string; periodStart: string; periodEnd: string },
): Promise<WorkforceTimesheetApprovalRow[]> {
  const rangeStart = new Date(`${scope.periodStart}T00:00:00.000Z`)
  const rangeEndExclusive = new Date(`${addDateKeyDays(scope.periodEnd, 1)}T00:00:00.000Z`)
  const workdays: WorkforceTimesheetWorkday[] = await tx.mtmAgentWorkday.findMany({
    where: {
      organizationId: scope.organizationId,
      agentId: scope.agentId,
      workDate: { gte: rangeStart, lt: rangeEndExclusive },
    },
    orderBy: [{ workDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      agentId: true,
      workDate: true,
      status: true,
      startedAt: true,
      pausedAt: true,
      completedAt: true,
      totalPausedSeconds: true,
    },
  })
  if (workdays.length === 0) {
    throw conflict(
      "WORKFORCE_TIMESHEET_APPROVAL_NO_WORKDAYS",
      "The requested period has no recorded workdays to approve",
    )
  }
  if (workdays.some((workday) => workday.status !== "COMPLETED" || !workday.completedAt)) {
    throw conflict(
      "WORKFORCE_TIMESHEET_APPROVAL_WORKDAY_NOT_FINAL",
      "Every recorded workday in the requested period must be completed before approval",
      workdays
        .filter((workday) => workday.status !== "COMPLETED" || !workday.completedAt)
        .map((workday) => ({
          workdayId: workday.id,
          workDate: workday.workDate.toISOString().slice(0, 10),
          reason: "WORKDAY_NOT_FINAL" as const,
        })),
    )
  }

  const workdayIds = workdays.map((workday) => workday.id)
  const [policySnapshots, shiftSnapshots]: [
    WorkforcePolicySnapshotForCalculation[],
    WorkforceShiftSnapshotForCalculation[],
  ] = await Promise.all([
    tx.workforcePolicySnapshot.findMany({
      where: { organizationId: scope.organizationId, workdayId: { in: workdayIds } },
      select: {
        id: true,
        workdayId: true,
        agentId: true,
        workDate: true,
        expectedWorkSeconds: true,
        lateGraceSeconds: true,
        undertimeToleranceSeconds: true,
        overtimeThresholdSeconds: true,
        longPauseThresholdSeconds: true,
      },
    }),
    tx.workforceShiftSnapshot.findMany({
      where: { organizationId: scope.organizationId, workdayId: { in: workdayIds } },
      select: {
        id: true,
        workdayId: true,
        agentId: true,
        workDate: true,
        timezone: true,
        plannedStartAt: true,
        plannedEndAt: true,
      },
    }),
  ])
  const policyByWorkday = new Map(policySnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
  const shiftByWorkday = new Map(shiftSnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
  if (workdays.some((workday) => !policyByWorkday.has(workday.id) || !shiftByWorkday.has(workday.id))) {
    throw conflict(
      "WORKFORCE_TIMESHEET_APPROVAL_SNAPSHOT_MISSING",
      "Every recorded workday in the requested period needs immutable policy and shift snapshots",
      workdays
        .filter((workday) => !policyByWorkday.has(workday.id) || !shiftByWorkday.has(workday.id))
        .map((workday) => ({
          workdayId: workday.id,
          workDate: workday.workDate.toISOString().slice(0, 10),
          reason: "SNAPSHOT_MISSING" as const,
        })),
    )
  }

  const [events, corrections]: [WorkforceWorkdayEventRecord[], WorkforceCorrectionRecord[]] = await Promise.all([
    tx.mtmAgentWorkdayEvent.findMany({
      where: { organizationId: scope.organizationId, agentId: scope.agentId, workdayId: { in: workdayIds } },
      orderBy: [{ workdayId: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
      select: { id: true, workdayId: true, type: true, occurredAt: true },
    }),
    tx.workforceTimeCorrection.findMany({
      where: { organizationId: scope.organizationId, agentId: scope.agentId, workdayId: { in: workdayIds } },
      orderBy: [{ workdayId: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
      select: { id: true, workdayId: true, beforeFacts: true, afterFacts: true },
    }),
  ])
  const eventsByWorkday = recordsByWorkday(events)
  const correctionsByWorkday = recordsByWorkday(corrections)

  const rows = workdays.map((workday) => {
    const policySnapshot = policyByWorkday.get(workday.id)!
    const shiftSnapshot = shiftByWorkday.get(workday.id)!
    try {
      const result = rehydrateWorkforceTimesheetDay({
        // `completedAt` is present above, so approval never freezes a
        // provisional as-of calculation.
        asOf: workday.completedAt!,
        workday,
        policySnapshot,
        shiftSnapshot,
        events: (eventsByWorkday.get(workday.id) ?? []).map((event) => ({
          id: event.id,
          type: event.type as "START" | "PAUSE" | "RESUME" | "FINISH",
          occurredAt: event.occurredAt.toISOString(),
        })),
        corrections: correctionsByWorkday.get(workday.id) ?? [],
      })
      return {
        workdayId: workday.id,
        agentId: workday.agentId,
        workDate: workday.workDate.toISOString().slice(0, 10),
        calculationVersion: result.calculation.calculationVersion,
        calculation: result.calculation,
      }
    } catch (error) {
      if (error instanceof WorkforceTimesheetRehydrationError) {
        throw conflict(
          "WORKFORCE_TIMESHEET_APPROVAL_HISTORY_INVALID",
          "A recorded workday cannot be reproduced from its immutable history",
          [{
            workdayId: workday.id,
            workDate: workday.workDate.toISOString().slice(0, 10),
            reason: "HISTORY_INVALID",
          }],
        )
      }
      throw error
    }
  })

  const rowByWorkdayId = new Map(rows.map((row) => [row.workdayId, row]))
  const workdayById = new Map(workdays.map((workday) => [workday.id, workday]))
  const [calculationExceptions, exceptionCaseRefs] = await Promise.all([
    tx.workforceAttendanceException.findMany({
      where: {
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        workdayId: { in: workdayIds },
        status: { not: "RESOLVED" },
      },
      orderBy: [{ workdayId: "asc" }, { type: "asc" }, { id: "asc" }],
      select: { workdayId: true, type: true, status: true, calculationVersion: true },
    }),
    tx.workforceExceptionCase.findMany({
      where: {
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        OR: [
          { workdayId: { in: workdayIds } },
          { workdayEvent: { workdayId: { in: workdayIds } } },
          { expectedWorkDate: { gte: rangeStart, lt: rangeEndExclusive } },
        ],
      },
      orderBy: [{ expectedWorkDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: MAX_APPROVAL_EXCEPTION_CASES + 1,
      select: { id: true },
    }),
  ])

  if (exceptionCaseRefs.length > MAX_APPROVAL_EXCEPTION_CASES) {
    throw conflict(
      "WORKFORCE_TIMESHEET_APPROVAL_EXCEPTION_LIMIT_EXCEEDED",
      "The requested period has too many exception cases for one safe approval",
    )
  }

  const exceptionCaseIds = exceptionCaseRefs.map(({ id }) => id).sort()
  // The workday lock is acquired first. Current no-show/missed-finish case
  // producers use that same employee lane, so the case set is stable. Lock
  // each existing C6 decision stream in deterministic ID order and only then
  // read its final lifecycle. The decision writer uses this exact lock key.
  for (const caseId of exceptionCaseIds) {
    await lockWorkforceExceptionDecisionStream(tx, {
      organizationId: scope.organizationId,
      caseId,
    })
  }
  const exceptionCases = exceptionCaseIds.length === 0
    ? []
    : await tx.workforceExceptionCase.findMany({
      where: {
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        id: { in: exceptionCaseIds },
      },
      orderBy: [{ expectedWorkDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        workdayId: true,
        expectedWorkDate: true,
        workdayEvent: { select: { workdayId: true, workday: { select: { workDate: true } } } },
        decisions: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: MAX_APPROVAL_CASE_DECISIONS + 1,
          select: { decisionCode: true },
        },
      },
    })
  if (exceptionCases.length !== exceptionCaseIds.length) {
    throw conflict(
      "WORKFORCE_TIMESHEET_APPROVAL_EXCEPTION_HISTORY_INVALID",
      "An attendance exception changed while the requested period was being approved",
    )
  }

  const calculationBlockers: WorkforceTimesheetApprovalBlocker[] = calculationExceptions.flatMap((exception) => {
    const row = rowByWorkdayId.get(exception.workdayId)
    const workday = workdayById.get(exception.workdayId)
    if (
      !row
      || !workday
      || row.calculationVersion !== exception.calculationVersion
      || (exception.status !== "OPEN" && exception.status !== "ACKNOWLEDGED")
    ) return []
    return [{
      workdayId: exception.workdayId,
      workDate: workday.workDate.toISOString().slice(0, 10),
      reason: "UNRESOLVED_EXCEPTION",
      exceptionType: exception.type,
      exceptionStage: exception.status === "OPEN" ? "OPEN" : "HR_REVIEW",
    }]
  })

  const caseBlockers: WorkforceTimesheetApprovalBlocker[] = exceptionCases.flatMap((exceptionCase) => {
    const decisionsTruncated = exceptionCase.decisions.length > MAX_APPROVAL_CASE_DECISIONS
    const lifecycle = decisionsTruncated
      ? null
      : evaluateWorkforceExceptionDraftLifecycle(exceptionCase.decisions)
    if (lifecycle?.valid && lifecycle.stage === "RESOLVED") return []

    const linkedWorkdayId = exceptionCase.workdayId ?? exceptionCase.workdayEvent?.workdayId ?? undefined
    const workDate = exceptionCase.expectedWorkDate
      ?? (linkedWorkdayId ? workdayById.get(linkedWorkdayId)?.workDate : undefined)
      ?? exceptionCase.workdayEvent?.workday.workDate
    if (!workDate) {
      // This should be unreachable because the query admits only period-bound
      // subjects. Refuse the whole approval instead of inventing a date.
      throw conflict(
        "WORKFORCE_TIMESHEET_APPROVAL_EXCEPTION_HISTORY_INVALID",
        "An attendance exception cannot be tied to a reproducible workday",
      )
    }
    return [{
      ...(linkedWorkdayId ? { workdayId: linkedWorkdayId } : {}),
      caseReference: `WF-${exceptionCase.id.slice(-8)}`,
      workDate: workDate.toISOString().slice(0, 10),
      reason: "UNRESOLVED_EXCEPTION",
      ...(approvalExceptionType(exceptionCase.kind) ? { exceptionType: approvalExceptionType(exceptionCase.kind) } : {}),
      exceptionStage: !lifecycle || !lifecycle.valid ? "DATA_INTEGRITY_REVIEW" : lifecycle.stage,
    }]
  })

  const blockers = [...calculationBlockers, ...caseBlockers].sort((left, right) => (
    left.workDate.localeCompare(right.workDate)
    || (left.workdayId ?? "").localeCompare(right.workdayId ?? "")
    || (left.caseReference ?? "").localeCompare(right.caseReference ?? "")
    || (left.exceptionType ?? "").localeCompare(right.exceptionType ?? "")
  ))
  if (blockers.length > 0) {
    throw conflict(
      "WORKFORCE_TIMESHEET_APPROVAL_UNRESOLVED_EXCEPTIONS",
      "Every unresolved attendance exception in the requested period must be resolved before approval",
      blockers,
    )
  }
  return rows
}

/**
 * Approves a reconstructed timesheet under the canonical workday writer lock.
 * Direct corrections acquire the same lock, so an approval cannot race an
 * append-only correction ledger and freeze stale mutable timestamps.
 */
export async function approveWorkforceTimesheet(
  context: WorkforceTimesheetApprovalContext,
): Promise<WorkforceTimesheetApprovalResult> {
  const { organizationId, userId, actor, input, audit } = context
  if (actor.role === "AGENT" || !isAgentInWorkforceScope(actor, input.agentId)) {
    return { kind: "forbidden" }
  }

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const employee = await tx.mtmAgent.findFirst({
        where: { id: input.agentId, organizationId, status: "ACTIVE" },
        select: { id: true, userId: true },
      })
      if (!employee) throw new WorkforceTimesheetApprovalProblem({ kind: "not_found" })
      // Separation of duties: a manager or administrator cannot approve their
      // own recorded time, even when their organizational scope includes it.
      if (actor.agentId === employee.id || employee.userId === userId) return { kind: "forbidden" as const }

      await lockMtmWorkdayTransitions(tx, { organizationId, agentId: employee.id })
      const rows = await rebuildApprovalRows(tx, {
        organizationId,
        agentId: employee.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      })
      let payload
      try {
        payload = buildWorkforceTimesheetApproval({
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          agentId: employee.id,
          rows,
        })
      } catch (error) {
        if (error instanceof WorkforceTimesheetApprovalError) {
          throw conflict("WORKFORCE_TIMESHEET_APPROVAL_INVALID", error.message)
        }
        throw error
      }
      const stored = await persistWorkforceTimesheetApproval({
        organizationId,
        approvedByUserId: userId,
        payload,
        correctionReason: input.correctionReason,
        db: tx,
      })
      const recordKind = stored.revision === 1 ? "APPROVAL" : "CORRECTION"
      if (!stored.idempotent) {
        // Approval audit metadata records the actor, scope, immutable hashes
        // and correction reason, but deliberately not the raw per-event facts.
        await tx.mtmAuditLog.create({
          data: {
            organizationId,
            agentId: employee.id,
            action: "WORKFORCE_TIMESHEET_APPROVED",
            entity: "timesheet_approval",
            entityId: stored.id,
            metadataKind: "workforce_timesheet_approval",
            newData: {
              agentId: employee.id,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              recordKind,
              revision: stored.revision,
              calculationVersion: payload.calculationVersion,
              rowsHash: payload.rowsHash,
              factsHash: payload.factsHash,
              correctionReason: recordKind === "CORRECTION" ? input.correctionReason ?? null : null,
              approvedByUserId: userId,
            },
            ipAddress: audit?.ipAddress ?? null,
            userAgent: audit?.userAgent ?? null,
          },
        })
      }
      return {
        kind: "success" as const,
        data: {
          id: stored.id,
          revision: stored.revision,
          recordKind,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          agentId: employee.id,
          rowsHash: payload.rowsHash,
          factsHash: payload.factsHash,
          calculationVersion: payload.calculationVersion,
        },
        idempotent: stored.idempotent,
      }
    })
  } catch (error) {
    if (error instanceof WorkforceTimesheetApprovalProblem) return error.result
    if (error instanceof WorkforceTimesheetApprovalError) {
      return { kind: "conflict", code: error.code, message: error.message }
    }
    throw error
  }
}
