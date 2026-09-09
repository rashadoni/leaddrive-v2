import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { withMobileRls } from "@/lib/with-mobile-rls"

const MAX_RANGE_DAYS = 42
const MAX_MEETINGS = 1_000
const DAY_MS = 86_400_000

type TeamScheduleWindow = {
  from: string
  to: string
  days: number
}

function inclusiveDayCount(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  ) + 1
}

function scheduleWindow(searchParams: URLSearchParams): TeamScheduleWindow | null {
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if (!from || !to || !isDateKey(from) || !isDateKey(to) || to < from) return null

  const days = inclusiveDayCount(from, to)
  if (days < 1 || days > MAX_RANGE_DAYS) return null
  return { from, to, days }
}

/**
 * GET /api/v1/mtm/mobile/team-schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Privacy boundary for the optional agent-to-agent calendar. The tenant must
 * opt in explicitly. Even then the response is same-team only and exposes a
 * deliberately small meeting card — never GPS, phone numbers, notes, or the
 * underlying customer/contact identifiers.
 */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  const window = scheduleWindow(new URL(req.url).searchParams)
  if (!window) {
    return NextResponse.json({
      error: `Use an inclusive from/to range of at most ${MAX_RANGE_DAYS} days`,
      code: "MTM_TEAM_SCHEDULE_RANGE_INVALID",
    }, { status: 400 })
  }

  try {
    const settings = await getMtmSettings(auth.orgId)

    // Fail closed. Do not even resolve the team or query colleague routes until
    // an administrator has deliberately enabled this tenant policy.
    if (!settings.teamScheduleVisibilityEnabled) {
      return NextResponse.json({
        success: true,
        data: {
          enabled: false,
          from: window.from,
          to: window.to,
          days: window.days,
          maxRangeDays: MAX_RANGE_DAYS,
          scope: "DISABLED",
          meetings: [],
          truncated: false,
        },
      })
    }

    const actor = await prisma.mtmAgent.findFirst({
      where: {
        id: auth.agentId,
        organizationId: auth.orgId,
        status: "ACTIVE",
        role: "AGENT",
      },
      select: { id: true, teamId: true },
    })
    if (!actor) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    if (!actor.teamId) {
      return NextResponse.json({
        success: true,
        data: {
          enabled: true,
          from: window.from,
          to: window.to,
          days: window.days,
          maxRangeDays: MAX_RANGE_DAYS,
          scope: "NO_TEAM",
          meetings: [],
          truncated: false,
        },
      })
    }

    const rangeStart = new Date(`${window.from}T00:00:00.000Z`)
    const rangeEndExclusive = new Date(`${addDateKeyDays(window.to, 1)}T00:00:00.000Z`)
    const rows = await prisma.mtmRoutePoint.findMany({
      where: {
        organizationId: auth.orgId,
        deletedAt: null,
        route: {
          organizationId: auth.orgId,
          deletedAt: null,
          date: { gte: rangeStart, lt: rangeEndExclusive },
          status: { in: ["PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE"] },
          publishedVersion: { not: null },
          agentId: { not: auth.agentId },
          assignments: { none: { agentId: auth.agentId, removedAt: null } },
          agent: {
            organizationId: auth.orgId,
            teamId: actor.teamId,
            status: "ACTIVE",
            role: "AGENT",
          },
        },
      },
      orderBy: [
        { route: { date: "asc" } },
        { plannedTime: { sort: "asc", nulls: "last" } },
        { orderIndex: "asc" },
        { id: "asc" },
      ],
      take: MAX_MEETINGS + 1,
      select: {
        id: true,
        status: true,
        plannedTime: true,
        customer: {
          select: { name: true, address: true, city: true },
        },
        contact: {
          select: { displayName: true },
        },
        route: {
          select: {
            date: true,
            status: true,
            agent: { select: { id: true, name: true } },
          },
        },
      },
    })

    const truncated = rows.length > MAX_MEETINGS
    const meetings = (truncated ? rows.slice(0, MAX_MEETINGS) : rows).map((row) => ({
      id: row.id,
      date: row.route.date.toISOString().slice(0, 10),
      plannedTime: row.plannedTime?.toISOString() ?? null,
      agent: {
        id: row.route.agent.id,
        name: row.route.agent.name,
      },
      customer: { name: row.customer.name },
      contact: row.contact ? { displayName: row.contact.displayName } : null,
      location: {
        address: row.customer.address,
        city: row.customer.city,
      },
      routeStatus: row.route.status,
      pointStatus: row.status,
    }))

    return NextResponse.json({
      success: true,
      data: {
        enabled: true,
        from: window.from,
        to: window.to,
        days: window.days,
        maxRangeDays: MAX_RANGE_DAYS,
        scope: "TEAM",
        meetings,
        truncated,
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/team-schedule GET]", error)
    return NextResponse.json({ error: "Failed to load team schedule" }, { status: 500 })
  }
})
