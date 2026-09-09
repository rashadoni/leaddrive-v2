import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { isAgentInWorkforceScope, resolveWorkforceActor } from "@/lib/workforce/actor"
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

type WorkforceDirectoryAgent = {
  id: string
  name: string
  role: string
  teamId: string | null
}

/** Prisma returns the canonical event instant as a Date; the replay service
 * deliberately receives the serialized UTC form below. */
type WorkforceWorkdayEventRecord = Omit<WorkforceWorkdayEventFact, "occurredAt"> & {
  workdayId: string
  occurredAt: Date
}
type WorkforceCorrectionRecord = WorkforceTimeCorrectionReplayFact & { workdayId: string }

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

/** GET /api/v1/workforce/timesheet?start=YYYY-MM-DD&end=YYYY-MM-DD&agentId=… */
export const GET = withWorkforceRlsAuth("read", async (req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return workforceScopeDenied()

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
    if (requestedAgentId && !isAgentInWorkforceScope(actor, requestedAgentId)) return workforceScopeDenied()

    const agentWhere = {
      organizationId: auth.orgId,
      status: "ACTIVE" as const,
      ...(requestedAgentId
        ? { id: requestedAgentId }
        : actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }),
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
    const [policySnapshots, shiftSnapshots]: [
      WorkforcePolicySnapshotForCalculation[],
      WorkforceShiftSnapshotForCalculation[],
    ] = workdayIds.length > 0
      ? await Promise.all([
          prisma.workforcePolicySnapshot.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
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
          prisma.workforceShiftSnapshot.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: workdayIds } },
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
      : [[], []]
    const policyByWorkday = new Map(policySnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
    const shiftByWorkday = new Map(shiftSnapshots.map((snapshot) => [snapshot.workdayId, snapshot]))
    const snapshottedWorkdayIds = workdayIds.filter((workdayId) => (
      policyByWorkday.has(workdayId) && shiftByWorkday.has(workdayId)
    ))
    const [events, corrections]: [WorkforceWorkdayEventRecord[], WorkforceCorrectionRecord[]] = snapshottedWorkdayIds.length > 0
      ? await Promise.all([
          prisma.mtmAgentWorkdayEvent.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: snapshottedWorkdayIds } },
            orderBy: [{ workdayId: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
            select: { id: true, workdayId: true, type: true, occurredAt: true },
          }),
          prisma.workforceTimeCorrection.findMany({
            where: { organizationId: auth.orgId, workdayId: { in: snapshottedWorkdayIds } },
            orderBy: [{ workdayId: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
            select: { id: true, workdayId: true, beforeFacts: true, afterFacts: true },
          }),
        ])
      : [[], []]
    const eventsByWorkday = recordsByWorkday(events)
    const correctionsByWorkday = recordsByWorkday(corrections)
    const now = new Date()
    const rows = workdays.map((workday) => {
      const policySnapshot = policyByWorkday.get(workday.id)
      const shiftSnapshot = shiftByWorkday.get(workday.id)
      const base = {
        ...workday,
        date: workday.workDate.toISOString().slice(0, 10),
      }
      if (!policySnapshot || !shiftSnapshot) {
        return {
          ...base,
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
          events: (eventsByWorkday.get(workday.id) ?? []).map((event) => ({
            id: event.id,
            type: event.type as "START" | "PAUSE" | "RESUME" | "FINISH",
            occurredAt: event.occurredAt.toISOString(),
          })),
          corrections: correctionsByWorkday.get(workday.id) ?? [],
        })
        return {
          ...base,
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
        summary: { totalWorkedSeconds, workdayCount: rows.length, calculatedWorkdayCount, unavailableWorkdayCount },
      },
    })
  } catch (error) {
    console.error("[workforce/timesheet GET]", error)
    return NextResponse.json({ error: "Failed to load workforce timesheet" }, { status: 500 })
  }
})
