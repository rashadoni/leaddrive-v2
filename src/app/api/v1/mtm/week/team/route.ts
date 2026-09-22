import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { checkRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { OPERATIONAL_WEEK_LIMITS, resolveOperationalWeekWindow } from "@/lib/mtm/operational-week"
import { buildMtmTeamTodayRows, rememberMtmTeamGpsRead } from "@/lib/mtm/week-team-today"

/**
 * GET /api/v1/mtm/week/team — the Panel's default "team today" table.
 *
 * Same actor scope and region/team filters as `/api/v1/mtm/week`; every read
 * below is bounded to those agent ids and to the tenant-local today. Only
 * times and counts leave the server: no coordinates, no note text.
 */

const TEAM_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }
const TEAM_VISIT_LIMIT = 2_000
/** Up to this many ids are written into the audit row verbatim; beyond it, count + hash. */
const AUDIT_AGENT_IDS_INLINE = 100

function trimmedParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim().slice(0, 100) ?? ""
}

async function workforceEnabled(organizationId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    return Boolean(organization && isTenantCapabilityEnabled("workforce-hrm", organization))
  } catch (error) {
    console.warn("[MTM/week/team GET] Workforce capability lookup failed", error)
    return false
  }
}

export const GET = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const rateLimitKey = `mtm-week-team:${auth.orgId}:${auth.principal}:${auth.userId || auth.agentId || "principal"}`
  if (!checkRateLimit(rateLimitKey, TEAM_RATE_LIMIT)) {
    return NextResponse.json({
      error: "Refresh rate limit exceeded",
      code: "MTM_WEEK_RATE_LIMITED",
      retryAfterSeconds: 15,
    }, { status: 429, headers: { "Retry-After": "15" } })
  }

  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden", code: "MTM_WEEK_ACTOR_NOT_FOUND" }, { status: 403 })
  if (actor.role === "AGENT" && !actor.agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_WEEK_ACTOR_NOT_FOUND" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const regionId = trimmedParam(searchParams, "regionId")
  const teamId = trimmedParam(searchParams, "teamId")

  const [settings, canReadWorkforce] = await Promise.all([
    getMtmSettings(auth.orgId),
    workforceEnabled(auth.orgId),
  ])
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const maxAccuracyMeters = Math.min(1_000, Math.max(5, settings.historyMaxAccuracyMeters))
  const generatedAt = new Date()
  const today = currentDateKey(generatedAt, timezone)
  const window = resolveOperationalWeekWindow(today, 1, timezone)!

  // An AGENT sees one row: themselves. Everyone else sees the resolved scope.
  const scopeIds = actor.role === "AGENT" ? [actor.agentId!] : actor.scopedAgentIds
  const agentWhere: Prisma.MtmAgentWhereInput = {
    organizationId: auth.orgId,
    status: "ACTIVE",
    ...(scopeIds === null ? {} : { id: { in: [...scopeIds] } }),
    ...(teamId ? { teamId } : {}),
    ...(regionId ? { team: { is: { regionId } } } : {}),
  }
  const agentsRaw = await prisma.mtmAgent.findMany({
    where: agentWhere,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: OPERATIONAL_WEEK_LIMITS.filterAgents + 1,
    select: { id: true, name: true, team: { select: { id: true, name: true } } },
  })
  const agents = agentsRaw.slice(0, OPERATIONAL_WEEK_LIMITS.filterAgents)
  const agentsTruncated = agentsRaw.length > OPERATIONAL_WEEK_LIMITS.filterAgents
  const agentIds = agents.map((agent) => agent.id)

  if (agentIds.length === 0) {
    return NextResponse.json({
      success: true,
      data: { mode: "TEAM_TODAY", timezone, today, generatedAt, rows: [], completeness: { authoritative: true, truncatedSources: [] }, capabilities: { workday: { enabled: canReadWorkforce } } },
    })
  }

  const [locations, routes, visitsRaw, alertCounts, workdays] = await Promise.all([
    prisma.mtmAgentLocation.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: { in: agentIds },
        recordedAt: { gte: window.activityStart, lt: window.activityEnd },
        OR: [{ accuracy: null }, { accuracy: { gte: 0, lte: maxAccuracyMeters } }],
      },
      orderBy: [{ agentId: "asc" }, { recordedAt: "desc" }],
      distinct: ["agentId"],
      select: { agentId: true, recordedAt: true },
    }),
    prisma.mtmRoute.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: { in: agentIds },
        date: { gte: window.routeStart, lt: window.routeEnd },
        deletedAt: null,
        publishedVersion: { not: null },
      },
      select: {
        agentId: true,
        status: true,
        totalPoints: true,
        visitedPoints: true,
        // «Where is he going»: the first stop still ahead on today's route.
        points: {
          where: { deletedAt: null, status: "PENDING" },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          take: 1,
          select: { orderIndex: true, plannedTime: true, customer: { select: { name: true } } },
        },
      },
    }),
    prisma.mtmVisit.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: { in: agentIds },
        deletedAt: null,
        checkInAt: { gte: window.activityStart, lt: window.activityEnd },
      },
      // Newest first: when the cap bites it drops the morning, not the
      // afternoon a manager is looking at.
      orderBy: [{ checkInAt: "desc" }, { id: "desc" }],
      take: TEAM_VISIT_LIMIT + 1,
      select: { id: true, agentId: true, status: true, checkInAt: true, checkOutAt: true, customer: { select: { name: true } } },
    }),
    prisma.mtmAlert.groupBy({
      by: ["agentId"],
      where: {
        organizationId: auth.orgId,
        agentId: { in: agentIds },
        isResolved: false,
        createdAt: { gte: window.activityStart, lt: window.activityEnd },
      },
      _count: { _all: true },
    }),
    canReadWorkforce ? prisma.mtmAgentWorkday.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: { in: agentIds },
        OR: [
          { workDate: window.routeStart },
          { status: { in: ["STARTED", "PAUSED"] } },
        ],
      },
      select: { agentId: true, status: true, workDate: true, startedAt: true, pausedAt: true, completedAt: true },
    }) : Promise.resolve([] as Array<{ agentId: string; status: string; workDate: Date; startedAt: Date | null; pausedAt: Date | null; completedAt: Date | null }>),
  ])

  const scopeSet = new Set(agentIds)
  const visitsTruncated = visitsRaw.length > TEAM_VISIT_LIMIT
  const rows = buildMtmTeamTodayRows({
    now: generatedAt,
    todayKey: today,
    workforceEnabled: canReadWorkforce,
    agents,
    // Defense in depth: every set is re-filtered to the scoped ids.
    latestLocations: locations.filter((row) => scopeSet.has(row.agentId)),
    routes: routes.filter((row) => scopeSet.has(row.agentId)),
    visits: visitsRaw.slice(0, TEAM_VISIT_LIMIT).filter((row) => scopeSet.has(row.agentId)),
    openAlertCounts: (alertCounts as Array<{ agentId: string; _count?: { _all?: number } }>)
      .filter((row) => scopeSet.has(row.agentId))
      .map((row) => ({ agentId: row.agentId, count: row._count?._all ?? 0 })),
    workdays: workdays.filter((row) => scopeSet.has(row.agentId)),
  })

  const gpsAgentIds = [...new Set(locations.filter((row) => scopeSet.has(row.agentId)).map((row) => row.agentId))].sort()
  if (gpsAgentIds.length) {
    const agentIdsHash = createHash("sha256").update(gpsAgentIds.join("\0")).digest("hex")
    const reader = auth.userId || auth.agentId || auth.principal
    if (rememberMtmTeamGpsRead(`${auth.orgId}:${reader}:${agentIdsHash}:${today}`)) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: auth.agentId ?? null,
        action: "WEEK_TEAM_GPS_LATEST_READ",
        entity: "agent",
        entityId: null,
        metadataKind: "gps_latest_access",
        newData: {
          readerUserId: auth.userId || null,
          readerAgentId: auth.agentId || null,
          principal: auth.principal,
          date: today,
          agentCount: gpsAgentIds.length,
          agentIdsHash,
          ...(gpsAgentIds.length <= AUDIT_AGENT_IDS_INLINE ? { agentIds: gpsAgentIds } : {}),
          source: "LATEST_RECORDED_TIME_ONLY",
        },
        req,
      }).catch((error) => console.warn("[MTM/week/team] GPS access audit failed", error))
    }
  }

  const truncatedSources = [
    ...(agentsTruncated ? ["FILTER_AGENTS"] : []),
    ...(visitsTruncated ? ["VISITS"] : []),
  ]
  return NextResponse.json({
    success: true,
    data: {
      mode: "TEAM_TODAY",
      timezone,
      today,
      generatedAt,
      rows,
      completeness: { authoritative: truncatedSources.length === 0, truncatedSources },
      capabilities: { workday: { enabled: canReadWorkforce } },
    },
  })
})
