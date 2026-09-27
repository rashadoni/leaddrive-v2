import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"

const SEGMENT_MODES = new Set(["SITE", "REMOTE", "FIELD", "TRAVEL", "ON_CALL", "EXCEPTION"])
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

type WorkdaySummary = {
  id: string
  workDate: Date
  status: "STARTED" | "PAUSED" | "COMPLETED"
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
  workforceShiftSnapshot: {
    timezone: string
    plannedStartAt: Date
    plannedEndAt: Date
  } | null
  workforceWorkdayScheduleSnapshot: {
    segments: unknown
    sites: unknown
  } | null
}

type MobileScheduleSegment = {
  state: "CURRENT" | "NEXT"
  mode: string
  startTime: string
  endTime: string
  siteName: string | null
  /**
   * Present only for the immutable server-selected next segment. It is safe
   * planning context for a generic local reminder, never presence evidence.
   */
  startsAt?: Date
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Returns only the employee-readable segment context from an immutable
 * snapshot. Site IDs, addresses, eligibility, proof-policy references and
 * geofence revisions are deliberately not a mobile-read projection.
 */
function mobileScheduleSegment(input: {
  workDate: Date
  timezone: string
  segments: unknown
  sites: unknown
  now: Date
}): MobileScheduleSegment | null {
  if (!isValidTimezone(input.timezone) || !Array.isArray(input.segments)) return null

  const siteNames = new Map<string, string>()
  if (Array.isArray(input.sites)) {
    for (const candidate of input.sites) {
      const site = object(candidate)
      if (typeof site?.id === "string" && typeof site.name === "string" && site.name.length <= 160) {
        siteNames.set(site.id, site.name)
      }
    }
  }

  const workDate = input.workDate.toISOString().slice(0, 10)
  const candidates = input.segments.flatMap((candidate) => {
    const segment = object(candidate)
    if (
      typeof segment?.mode !== "string"
      || !SEGMENT_MODES.has(segment.mode)
      || typeof segment.startTime !== "string"
      || typeof segment.endTime !== "string"
      || !LOCAL_TIME.test(segment.startTime)
      || !LOCAL_TIME.test(segment.endTime)
      || segment.endTime <= segment.startTime
      || (segment.siteId !== null && typeof segment.siteId !== "string")
    ) return []

    try {
      return [{
        mode: segment.mode,
        startTime: segment.startTime,
        endTime: segment.endTime,
        siteName: typeof segment.siteId === "string" ? siteNames.get(segment.siteId) ?? null : null,
        startAt: localDateTimeToUnambiguousUtc(`${workDate}T${segment.startTime}`, input.timezone),
        endAt: localDateTimeToUnambiguousUtc(`${workDate}T${segment.endTime}`, input.timezone),
      }]
    } catch {
      // A historical snapshot with a non-existent/ambiguous local time is not
      // reinterpreted by the client. Keep its display context unavailable.
      return []
    }
  })
  candidates.sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
  const current = candidates.find((segment) => segment.startAt <= input.now && input.now < segment.endAt)
  const next = candidates.find((segment) => input.now < segment.startAt)
  const selected = current ?? next
  if (!selected) return null
  return {
    state: current ? "CURRENT" : "NEXT",
    mode: selected.mode,
    startTime: selected.startTime,
    endTime: selected.endTime,
    siteName: selected.siteName,
    ...(current ? {} : { startsAt: selected.startAt }),
  }
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

/**
 * The mobile read model is an explicit allow-list. It does not serialize
 * action coordinates, event notes, site addresses/geofences or any QR/device
 * proof. An opt-in generic local reminder may use only an accepted immutable
 * shift-end snapshot or a server-selected next-segment instant; a displayed
 * site/segment is planning context, never presence evidence.
 */
function mobileWorkdaySummary(workday: WorkdaySummary, now: Date) {
  const { workforceShiftSnapshot, workforceWorkdayScheduleSnapshot } = workday
  const schedule = workforceShiftSnapshot == null ? null : {
    plannedStartAt: workforceShiftSnapshot.plannedStartAt,
    plannedEndAt: workforceShiftSnapshot.plannedEndAt,
    segment: workforceWorkdayScheduleSnapshot == null ? null : mobileScheduleSegment({
      workDate: workday.workDate,
      timezone: workforceShiftSnapshot.timezone,
      segments: workforceWorkdayScheduleSnapshot.segments,
      sites: workforceWorkdayScheduleSnapshot.sites,
      now,
    }),
  }
  return {
    id: workday.id,
    status: workday.status,
    startedAt: workday.startedAt,
    pausedAt: workday.pausedAt,
    completedAt: workday.completedAt,
    totalPausedSeconds: workday.totalPausedSeconds,
    workedSeconds: workedSeconds(workday, now),
    availableActions: availableActions(workday.status),
    schedule,
  }
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
      workforceShiftSnapshot: {
        select: { timezone: true, plannedStartAt: true, plannedEndAt: true },
      },
      workforceWorkdayScheduleSnapshot: {
        select: { segments: true, sites: true },
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
        workday: workday ? mobileWorkdaySummary(workday, now) : null,
        activeWorkday: activeWorkday && activeWorkday.id !== workday?.id
          ? mobileWorkdaySummary(activeWorkday, now)
          : null,
        availableActions: availableActions(workday?.status ?? null),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/workday GET]", error)
    return NextResponse.json({ error: "Failed to load workday" }, { status: 500 })
  }
})
