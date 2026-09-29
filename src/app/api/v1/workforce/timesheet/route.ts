import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { isAgentInWorkforceScope, resolveWorkforceActor } from "@/lib/workforce/actor"
import { workforceGranularAccessEnabled } from "@/lib/workforce/granular-access-rollout"
import {
  rehydrateWorkforceTimesheetDay,
  WorkforceTimesheetRehydrationError,
  type WorkforcePolicySnapshotForCalculation,
  type WorkforceShiftSnapshotForCalculation,
  type WorkforceTimesheetWorkday,
} from "@/lib/workforce/timesheet-rehydration"
import type {
  WorkforceWorkdayScheduleSnapshotForCalculation,
} from "@/lib/workforce/timesheet-schedule-snapshot"
import { requireWorkforceTimesheetReadAccess } from "@/lib/workforce/timesheet-read-access"
import {
  buildWorkforceTimesheetReadModel,
  projectWorkforceTimesheetExceptions,
  summarizeWorkforceTimesheetApprovalRevisions,
  WORKFORCE_TIMESHEET_READ_MODEL_LIMITS,
  WorkforceTimesheetReadModelError,
  type WorkforceTimesheetApprovalRevisionReadInput,
  type WorkforceTimesheetAttendanceReviewInput,
  type WorkforceTimesheetExceptionReadInput,
} from "@/lib/workforce/timesheet-read-model"
import {
  WORKFORCE_WORKDAY_JOURNAL_ORDER,
  WORKFORCE_WORKDAY_JOURNAL_SELECT,
  workforceWorkdayEventFact,
  type WorkforceTimeCorrectionReplayFact,
} from "@/lib/workforce/workday-facts-replay"

type WorkforceDirectoryAgent = {
  id: string
  name: string
  role: string
  teamId: string | null
}

/** Prisma returns the canonical event instants as Dates; the replay service
 * deliberately receives the serialized UTC form below. */
type WorkforceWorkdayEventRecord = Parameters<typeof workforceWorkdayEventFact>[0] & {
  workdayId: string
  attendanceReviewState: "LEGACY_UNKNOWN" | "NOT_REQUIRED" | "PENDING_REVIEW"
}
type WorkforceCorrectionRecord = WorkforceTimeCorrectionReplayFact & { workdayId: string }
type WorkforceAttendanceReviewRecord = WorkforceTimesheetAttendanceReviewInput & { workdayId: string }
type WorkforceCalculationExceptionRecord = WorkforceTimesheetExceptionReadInput & {
  workdayId: string
  calculationVersion: number
}
type WorkforceExceptionCaseRecord = {
  agentId: string
  kind: string
  workdayId: string | null
  expectedWorkDate: Date | null
  workdayEvent: { workdayId: string } | null
  decisions: Array<{ decisionCode: string; caseRevision: number }>
}
type WorkforceProjectedExceptionCase = {
  kind: string
  decisions: Array<{ decisionCode: string; caseRevision: number }>
  decisionHistoryTruncated: boolean
  [key: string]: unknown
}

const MAX_TIMESHEET_EXCEPTION_CASES = WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.exceptionCases
const MAX_TIMESHEET_EXCEPTION_DECISIONS = WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.decisionsPerCase
const MAX_TIMESHEET_APPROVAL_REVISIONS = WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.approvalRevisions
const MAX_TIMESHEET_EVENT_RECORDS = WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.eventRecordsPerRequest
const MAX_TIMESHEET_TRANSITION_RECORDS = WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.transitionRecordsPerRequest
const MAX_TIMESHEET_CALCULATION_EXCEPTION_RECORDS = WORKFORCE_TIMESHEET_READ_MODEL_LIMITS.calculationExceptionRecordsPerRequest

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

function recordsByWorkday<T extends { workdayId: string }>(records: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const record of records) {
    const existing = result.get(record.workdayId)
    if (existing) existing.push(record)
    else result.set(record.workdayId, [record])
  }
  return result
}

/**
 * GET /api/v1/workforce/timesheet?start=YYYY-MM-DD&end=YYYY-MM-DD&agentId=…
 *
 * This browser HR view returns named employee workdays and derived time facts.
 * API-key creator metadata is not a manager/employee delegation, so this path
 * is deliberately bound to an accountable human session.
 */
export const GET = withWorkforceSessionAuth("read", async (req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start") ?? addDateKeyDays(today, -13)
    const end = searchParams.get("end") ?? today
    const requestedAgentId = searchParams.get("agentId")
    if (!isDateKey(start) || !isDateKey(end) || end < start || end > addDateKeyDays(start, 92)) {
      return NextResponse.json({
        error: "start/end must be YYYY-MM-DD and cover at most 93 days",
        code: "WORKFORCE_TIMESHEET_RANGE_INVALID",
      }, { status: 400 })
    }
    // Resolve this feature flag and persisted grant before the named roster
    // query. A rolled-out tenant must never use the existing CRM actor scope
    // as a fallback Workforce attendance-read authority.
    const organization = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { features: true },
    })
    if (!organization) {
      return NextResponse.json({
        error: "Unable to verify Workforce timesheet access",
        code: "WORKFORCE_TIMESHEET_READ_ACCESS_UNAVAILABLE",
      }, { status: 503 })
    }
    const granularAccess = workforceGranularAccessEnabled(organization.features)
    // Granular tenants authorize through the explicit Workforce ledger. The
    // legacy CRM actor remains mandatory only before that deliberate cutover.
    if (!granularAccess && !actor) return workforceScopeDenied()
    if (!granularAccess && requestedAgentId && !isAgentInWorkforceScope(actor!, requestedAgentId)) {
      return workforceScopeDenied()
    }
    const accessDenied = await requireWorkforceTimesheetReadAccess({
      db: prisma,
      organizationId: auth.orgId,
      organizationFeatures: organization.features,
      principalUserId: auth.userId,
      selfAgentId: actor?.agentId ?? null,
      selectedAgentId: requestedAgentId,
    })
    if (accessDenied) return accessDenied

    const agentWhere = {
      organizationId: auth.orgId,
      status: "ACTIVE" as const,
      ...(requestedAgentId
        ? { id: requestedAgentId }
        : granularAccess || actor!.scopedAgentIds === null
          ? {}
          : { id: { in: [...actor!.scopedAgentIds] } }),
    }
    const agents: WorkforceDirectoryAgent[] = await prisma.mtmAgent.findMany({
      where: agentWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, teamId: true },
    })
    if (requestedAgentId && agents.length !== 1) return workforceScopeDenied()

    const rangeStart = new Date(`${start}T00:00:00.000Z`)
    const rangeEndExclusive = new Date(`${addDateKeyDays(end, 1)}T00:00:00.000Z`)
    const agentIds = agents.map((agent) => agent.id)
    const workdays: WorkforceTimesheetWorkday[] = agentIds.length > 0
      ? await prisma.mtmAgentWorkday.findMany({
          where: {
            organizationId: auth.orgId,
            agentId: { in: agentIds },
            workDate: { gte: rangeStart, lt: rangeEndExclusive },
          },
          orderBy: [{ agentId: "asc" }, { workDate: "asc" }],
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
      : []
    const workdayIds = workdays.map((workday) => workday.id)
    const [policySnapshots, shiftSnapshots, scheduleSnapshots]: [
      WorkforcePolicySnapshotForCalculation[],
      WorkforceShiftSnapshotForCalculation[],
      WorkforceWorkdayScheduleSnapshotForCalculation[],
    ] = workdayIds.length > 0
      ? await Promise.all([
          prisma.workforcePolicySnapshot.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
            select: {
              id: true,
              workdayId: true,
              agentId: true,
              workDate: true,
              definition: true,
              definitionHash: true,
              expectedWorkSeconds: true,
              lateGraceSeconds: true,
              undertimeToleranceSeconds: true,
              overtimeThresholdSeconds: true,
              longPauseThresholdSeconds: true,
            },
          }),
          prisma.workforceShiftSnapshot.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
            select: {
              id: true,
              workdayId: true,
              agentId: true,
              workDate: true,
              definition: true,
              definitionHash: true,
              timezone: true,
              plannedStartAt: true,
              plannedEndAt: true,
            },
          }),
          prisma.workforceWorkdayScheduleSnapshot.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
            select: {
              id: true,
              workdayId: true,
              agentId: true,
              workDate: true,
              policySnapshotId: true,
              shiftSnapshotId: true,
              schemaVersion: true,
              calendarState: true,
              calendarSnapshot: true,
              segments: true,
              sites: true,
              snapshotHash: true,
            },
          }),
        ])
      : [[], [], []]
    const policyByWorkday = new Map(policySnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
    const shiftByWorkday = new Map(shiftSnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
    const scheduleByWorkday = new Map(scheduleSnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
    const snapshottedWorkdayIds = workdayIds.filter((workdayId) => (
      policyByWorkday.has(workdayId)
      && shiftByWorkday.has(workdayId)
      && scheduleByWorkday.has(workdayId)
    ))
    const rangeEnd = new Date(`${end}T00:00:00.000Z`)
    const [
      events,
      corrections,
      siteTransitions,
      calculationExceptions,
      exceptionCases,
      approvalRevisions,
    ]: [
      WorkforceWorkdayEventRecord[],
      WorkforceCorrectionRecord[],
      WorkforceAttendanceReviewRecord[],
      WorkforceCalculationExceptionRecord[],
      WorkforceExceptionCaseRecord[],
      WorkforceTimesheetApprovalRevisionReadInput[],
    ] = await Promise.all([
      workdayIds.length > 0
        ? prisma.mtmAgentWorkdayEvent.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
            orderBy: [{ workdayId: "asc" }, ...WORKFORCE_WORKDAY_JOURNAL_ORDER],
            take: MAX_TIMESHEET_EVENT_RECORDS + 1,
            select: {
              ...WORKFORCE_WORKDAY_JOURNAL_SELECT,
              workdayId: true,
              attendanceReviewState: true,
            },
          })
        : Promise.resolve([] as WorkforceWorkdayEventRecord[]),
      snapshottedWorkdayIds.length > 0
        ? prisma.workforceTimeCorrection.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: snapshottedWorkdayIds } },
            orderBy: [{ workdayId: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
            select: { id: true, workdayId: true, beforeFacts: true, afterFacts: true },
          })
        : Promise.resolve([] as WorkforceCorrectionRecord[]),
      workdayIds.length > 0
        ? prisma.workforceSiteTransition.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
            orderBy: [{ workdayId: "asc" }, { claimedAt: "asc" }, { id: "asc" }],
            take: MAX_TIMESHEET_TRANSITION_RECORDS + 1,
            select: { workdayId: true, attendanceReviewState: true },
          })
        : Promise.resolve([]),
      workdayIds.length > 0
        ? prisma.workforceAttendanceException.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
            orderBy: [{ workdayId: "asc" }, { type: "asc" }, { id: "asc" }],
            take: MAX_TIMESHEET_CALCULATION_EXCEPTION_RECORDS + 1,
            select: { workdayId: true, type: true, status: true, calculationVersion: true },
          })
        : Promise.resolve([]),
      agentIds.length > 0
        ? prisma.workforceExceptionCase.findMany({
            where: {
              organizationId: auth.orgId,
              agentId: { in: agentIds },
              OR: [
                { workdayId: { in: workdayIds } },
                { workdayEvent: { workdayId: { in: workdayIds } } },
                { expectedWorkDate: { gte: rangeStart, lt: rangeEndExclusive } },
              ],
            },
            orderBy: [{ expectedWorkDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            take: MAX_TIMESHEET_EXCEPTION_CASES + 1,
            select: {
              agentId: true,
              kind: true,
              workdayId: true,
              expectedWorkDate: true,
              workdayEvent: { select: { workdayId: true } },
              decisions: {
                orderBy: { caseRevision: "asc" },
                take: MAX_TIMESHEET_EXCEPTION_DECISIONS + 1,
                select: { decisionCode: true, caseRevision: true },
              },
            },
          })
        : Promise.resolve([]),
      requestedAgentId
        ? prisma.workforceTimesheetApproval.findMany({
            where: {
              organizationId: auth.orgId,
              agentId: requestedAgentId,
              periodStart: rangeStart,
              periodEnd: rangeEnd,
            },
            orderBy: [{ revision: "asc" }, { id: "asc" }],
            take: MAX_TIMESHEET_APPROVAL_REVISIONS + 1,
            select: {
              id: true,
              agentId: true,
              periodStart: true,
              periodEnd: true,
              recordKind: true,
              revision: true,
              supersedesId: true,
              calculationVersion: true,
              rowsHash: true,
              factsHash: true,
              rows: true,
            },
          })
        : Promise.resolve([]),
    ])
    if (
      events.length > MAX_TIMESHEET_EVENT_RECORDS
      || siteTransitions.length > MAX_TIMESHEET_TRANSITION_RECORDS
      || calculationExceptions.length > MAX_TIMESHEET_CALCULATION_EXCEPTION_RECORDS
      || approvalRevisions.length > MAX_TIMESHEET_APPROVAL_REVISIONS
    ) {
      return NextResponse.json({
        error: "Too many records for one safe timesheet view",
        code: "WORKFORCE_TIMESHEET_READ_LIMIT_EXCEEDED",
      }, { status: 413 })
    }
    if (exceptionCases.length > MAX_TIMESHEET_EXCEPTION_CASES) {
      return NextResponse.json({
        error: "Too many exception cases for one safe timesheet view",
        code: "WORKFORCE_TIMESHEET_EXCEPTION_LIMIT_EXCEEDED",
      }, { status: 413 })
    }
    const eventsByWorkday = recordsByWorkday(events)
    const correctionsByWorkday = recordsByWorkday(corrections)
    const transitionsByWorkday = recordsByWorkday(siteTransitions)
    const calculatedExceptionsByWorkday = recordsByWorkday(calculationExceptions)
    const workdayIdByAgentDate = new Map(workdays.map((workday) => [
      `${workday.agentId}\u0000${workday.workDate.toISOString().slice(0, 10)}`,
      workday.id,
    ]))
    const exceptionCasesByWorkday = new Map<string, WorkforceProjectedExceptionCase[]>()
    const unrecordedExceptionCasesByAgentDate = new Map<string, {
      agentId: string
      workDate: string
      cases: WorkforceProjectedExceptionCase[]
    }>()
    for (const exceptionCase of exceptionCases) {
      const expectedDate = exceptionCase.expectedWorkDate?.toISOString().slice(0, 10)
      const workdayId = exceptionCase.workdayId
        ?? exceptionCase.workdayEvent?.workdayId
        ?? (expectedDate ? workdayIdByAgentDate.get(`${exceptionCase.agentId}\u0000${expectedDate}`) : undefined)
      const projected = {
        kind: exceptionCase.kind,
        decisions: exceptionCase.decisions.slice(0, MAX_TIMESHEET_EXCEPTION_DECISIONS),
        decisionHistoryTruncated: exceptionCase.decisions.length > MAX_TIMESHEET_EXCEPTION_DECISIONS,
      }
      if (workdayId) {
        const existing = exceptionCasesByWorkday.get(workdayId)
        if (existing) existing.push(projected)
        else exceptionCasesByWorkday.set(workdayId, [projected])
      } else if (expectedDate) {
        const key = `${exceptionCase.agentId}\u0000${expectedDate}`
        const existing = unrecordedExceptionCasesByAgentDate.get(key)
        if (existing) existing.cases.push(projected)
        else {
          unrecordedExceptionCasesByAgentDate.set(key, {
            agentId: exceptionCase.agentId,
            workDate: expectedDate,
            cases: [projected],
          })
        }
      }
    }
    const unrecordedWorkdayExceptions = [...unrecordedExceptionCasesByAgentDate.values()]
      .map(({ agentId, workDate, cases }) => ({
        agentId,
        workDate,
        exceptions: projectWorkforceTimesheetExceptions([], cases),
      }))
      .sort((left, right) => (
        left.agentId.localeCompare(right.agentId) || left.workDate.localeCompare(right.workDate)
      ))
    const approvalHistory = requestedAgentId
      ? summarizeWorkforceTimesheetApprovalRevisions(approvalRevisions)
      : null
    const reviewForWorkday = (workdayId: string, calculationVersions: readonly number[]) => {
      const currentCalculationVersions = new Set(calculationVersions)
      const readModel = buildWorkforceTimesheetReadModel({
        events: eventsByWorkday.get(workdayId) ?? [],
        transitions: transitionsByWorkday.get(workdayId) ?? [],
        exceptions: (calculatedExceptionsByWorkday.get(workdayId) ?? [])
          .filter((exception) => currentCalculationVersions.has(exception.calculationVersion)),
        exceptionCases: exceptionCasesByWorkday.get(workdayId) ?? [],
        approvals: [],
      })
      return {
        source: readModel.source,
        evidenceReview: readModel.evidenceReview,
        exceptions: readModel.exceptions,
        boundaries: readModel.boundaries,
      }
    }
    const now = new Date()
    const rows = workdays.map((workday) => {
      const policySnapshot = policyByWorkday.get(workday.id)
      const shiftSnapshot = shiftByWorkday.get(workday.id)
      const scheduleSnapshot = scheduleByWorkday.get(workday.id)
      const base = {
        ...workday,
        date: workday.workDate.toISOString().slice(0, 10),
      }
      if (!policySnapshot || !shiftSnapshot || !scheduleSnapshot) {
        return {
          ...base,
          review: reviewForWorkday(workday.id, []),
          // Legacy projection timestamps remain canonical workday facts, but
          // they are not an immutable policy/shift calculation and must never
          // look approval- or export-ready in the Workforce timesheet.
          workedSeconds: null,
          calculation: null,
          calculationStatus: "WORKFORCE_TIMESHEET_SNAPSHOT_MISSING",
        }
      }

      try {
        const result = rehydrateWorkforceTimesheetDay({
          // A closed day must not change when the report is re-opened later.
          // Open shifts remain explicitly provisional at the read instant.
          asOf: workday.completedAt ?? now,
          workday,
          policySnapshot,
          shiftSnapshot,
          scheduleSnapshot,
          events: (eventsByWorkday.get(workday.id) ?? []).map(workforceWorkdayEventFact),
          corrections: correctionsByWorkday.get(workday.id) ?? [],
        })
        const calculationVersions: Array<1 | 2> = [result.calculation.calculationVersion]
        if ("coreCalculationVersion" in result.calculation) {
          calculationVersions.push(result.calculation.coreCalculationVersion)
        }
        return {
          ...base,
          review: reviewForWorkday(workday.id, calculationVersions),
          workedSeconds: result.calculation.fact.workedSeconds,
          calculation: result.calculation,
          calculationStatus: "WORKFORCE_TIMESHEET_CALCULATED",
        }
      } catch (error) {
        if (error instanceof WorkforceTimesheetRehydrationError) {
          // Do not fall back to mutable timestamps after an immutable-chain
          // failure: that would make a corrupted closed day look exportable.
          return {
            ...base,
            review: reviewForWorkday(workday.id, []),
            workedSeconds: null,
            calculation: null,
            calculationStatus: "WORKFORCE_WORKDAY_HISTORY_INVALID",
          }
        }
        throw error
      }
    })
    const totalWorkedSeconds = rows.reduce((total, row) => total + (row.workedSeconds ?? 0), 0)
    const calculatedWorkdayCount = rows.filter((row) => row.calculationStatus === "WORKFORCE_TIMESHEET_CALCULATED").length
    const unavailableWorkdayCount = rows.filter((row) => row.calculationStatus === "WORKFORCE_WORKDAY_HISTORY_INVALID").length

    return NextResponse.json({
      success: true,
      data: {
        timezone,
        start,
        end,
        agents,
        rows,
        unrecordedWorkdayExceptions,
        approvalHistory,
        summary: { totalWorkedSeconds, workdayCount: rows.length, calculatedWorkdayCount, unavailableWorkdayCount },
      },
    })
  } catch (error) {
    if (error instanceof WorkforceTimesheetReadModelError) {
      return NextResponse.json({
        error: "The complete timesheet review history could not be verified",
        code: error.code,
      }, { status: 409 })
    }
    console.error("[workforce/timesheet GET]", error)
    return NextResponse.json({ error: "Failed to load workforce timesheet" }, { status: 500 })
  }
})
