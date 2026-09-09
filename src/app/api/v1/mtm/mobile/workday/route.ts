import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"

type WorkdaySummary = {
  status: "STARTED" | "PAUSED" | "COMPLETED"
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
}

function workedSeconds(workday: WorkdaySummary, now: Date): number {
  const end = workday.completedAt ?? now
  const currentPause = workday.status === "PAUSED" && workday.pausedAt
    ? Math.max(0, Math.floor((end.getTime() - workday.pausedAt.getTime()) / 1000))
    : 0
  const elapsed = Math.max(0, Math.floor((end.getTime() - workday.startedAt.getTime()) / 1000))
  return Math.max(0, elapsed - workday.totalPausedSeconds - currentPause)
}

function availableActions(status: WorkdaySummary["status"] | null): string[] {
  if (!status) return ["START"]
  if (status === "STARTED") return ["PAUSE", "FINISH"]
  if (status === "PAUSED") return ["RESUME", "FINISH"]
  return []
}

/** GET /api/v1/mtm/mobile/workday?date=YYYY-MM-DD */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_READ")
  if (forbidden) return forbidden
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const today = currentDateKey(new Date(), timezone)
    const requestedDate = new URL(req.url).searchParams.get("date") ?? today
    if (!isDateKey(requestedDate)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
    }
    const workDate = new Date(`${requestedDate}T00:00:00.000Z`)
    const select = {
      id: true,
      workDate: true,
      status: true,
      startedAt: true,
      pausedAt: true,
      completedAt: true,
      totalPausedSeconds: true,
      startLatitude: true,
      startLongitude: true,
      endLatitude: true,
      endLongitude: true,
      createdAt: true,
      updatedAt: true,
      events: {
        orderBy: { occurredAt: "asc" as const },
        select: {
          id: true,
          clientEventId: true,
          type: true,
          occurredAt: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          note: true,
        },
      },
    }
    const [workday, activeWorkday] = await Promise.all([
      prisma.mtmAgentWorkday.findFirst({
        where: { organizationId: auth.orgId, agentId: auth.agentId, workDate },
        select,
      }),
      prisma.mtmAgentWorkday.findFirst({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          status: { in: ["STARTED", "PAUSED"] },
        },
        orderBy: { startedAt: "desc" },
        select,
      }),
    ])
    const now = new Date()

    return NextResponse.json({
      success: true,
      data: {
        date: requestedDate,
        today,
        timezone,
        gpsIntervalSeconds: settings.gpsInterval,
        workday: workday
          ? {
              ...workday,
              workedSeconds: workedSeconds(workday, now),
              availableActions: availableActions(workday.status),
            }
          : null,
        activeWorkday: activeWorkday && activeWorkday.id !== workday?.id
          ? {
              ...activeWorkday,
              workedSeconds: workedSeconds(activeWorkday, now),
              availableActions: availableActions(activeWorkday.status),
            }
          : null,
        availableActions: availableActions(workday?.status ?? null),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/workday GET]", error)
    return NextResponse.json({ error: "Failed to load workday" }, { status: 500 })
  }
})
