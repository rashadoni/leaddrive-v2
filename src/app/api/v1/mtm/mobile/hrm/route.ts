import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  addDateKeyDays,
  currentDateKey,
  isDateKey,
} from "@/lib/mtm/mobile-week"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { isValidTimezone } from "@/lib/timezone"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"

type WorkdayRow = {
  id: string
  workDate: Date
  status: string
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
}

type HrmRequestRow = {
  id: string
  clientRequestId: string
  type: string
  status: string
  startDate: Date
  endDate: Date
  correctionWorkdayId: string | null
  requestedStartAt: Date | null
  requestedEndAt: Date | null
  reason: string
  decisionNote: string | null
  submittedAt: Date
  decidedAt: Date | null
  cancelledAt: Date | null
  updatedAt: Date
}

function dayCount(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000) + 1
}

export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_READ")
  if (forbidden) return forbidden
  try {
    const [settings, agent] = await Promise.all([
      getMtmSettings(auth.orgId),
      prisma.mtmAgent.findFirst({
        where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true, teamId: true },
      }),
    ])
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start") ?? addDateKeyDays(today, -14)
    const end = searchParams.get("end") ?? addDateKeyDays(today, 45)
    if (!isDateKey(start) || !isDateKey(end) || end < start || dayCount(start, end) > 93) {
      return NextResponse.json({
        error: "start/end must be YYYY-MM-DD and cover at most 93 days",
        code: "MTM_HRM_RANGE_INVALID",
      }, { status: 400 })
    }

    const rangeStart = new Date(`${start}T00:00:00.000Z`)
    const rangeEndExclusive = new Date(`${addDateKeyDays(end, 1)}T00:00:00.000Z`)
    const [calendarOverridesRaw, workdays, requests] = await Promise.all([
      prisma.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: auth.orgId,
          date: { gte: rangeStart, lt: rangeEndExclusive },
          deletedAt: null,
          OR: [
            { teamId: null, agentId: null },
            ...(agent.teamId ? [{ teamId: agent.teamId, agentId: null }] : []),
            { teamId: null, agentId: auth.agentId },
          ],
        },
        select: {
          id: true,
          date: true,
          kind: true,
          name: true,
          teamId: true,
          agentId: true,
          movedToDate: true,
          routePlanningAllowed: true,
        },
      }),
      prisma.mtmAgentWorkday.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          workDate: { gte: rangeStart, lt: rangeEndExclusive },
        },
        orderBy: { workDate: "asc" },
        select: {
          id: true,
          workDate: true,
          status: true,
          startedAt: true,
          pausedAt: true,
          completedAt: true,
          totalPausedSeconds: true,
        },
      }),
      prisma.mtmHrmRequest.findMany({
        where: { organizationId: auth.orgId, agentId: auth.agentId },
        orderBy: { submittedAt: "desc" },
        take: 200,
        select: {
          id: true,
          clientRequestId: true,
          type: true,
          status: true,
          startDate: true,
          endDate: true,
          correctionWorkdayId: true,
          requestedStartAt: true,
          requestedEndAt: true,
          reason: true,
          decisionNote: true,
          submittedAt: true,
          decidedAt: true,
          cancelledAt: true,
          updatedAt: true,
        },
      }),
    ])

    const overrides = calendarOverridesRaw as WorkCalendarOverride[]
    const typedWorkdays = workdays as WorkdayRow[]
    const typedRequests = requests as HrmRequestRow[]
    const workdayByDate = new Map(typedWorkdays.map((workday) => [workday.workDate.toISOString().slice(0, 10), workday]))
    const days = Array.from({ length: dayCount(start, end) }, (_, index) => addDateKeyDays(start, index)).map((date) => {
      const calendar = resolveWorkCalendarDay({
        date,
        overrides,
        teamId: agent.teamId,
        agentId: auth.agentId,
      })
      const activeRequests = typedRequests.filter((request) => (
        request.status !== "CANCELLED"
        && request.startDate.toISOString().slice(0, 10) <= date
        && request.endDate.toISOString().slice(0, 10) >= date
      ))
      return {
        date,
        calendar,
        workday: workdayByDate.get(date) ?? null,
        requests: activeRequests.map((request) => ({ id: request.id, type: request.type, status: request.status })),
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        timezone,
        start,
        end,
        days,
        requests: typedRequests,
        capabilities: {
          requestLeave: true,
          requestAbsence: true,
          requestTimeCorrection: true,
          cancelPending: true,
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/hrm GET]", error)
    return NextResponse.json({ error: "Failed to load HRM schedule" }, { status: 500 })
  }
})
