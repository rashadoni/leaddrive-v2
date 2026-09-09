import { NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { customerScopeForActor } from "@/lib/mtm/field-scope"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type ActiveAgentRow = Prisma.MtmAgentGetPayload<{ select: { id: true; name: true } }>
type AgentLocationLite = Prisma.MtmAgentLocationGetPayload<{
  select: { agentId: true; speed: true; recordedAt: true }
}>

// F-12: simple in-memory TTL cache for dashboard aggregates.
// The endpoint fans out ~15 parallel count() queries — under load this gets
// noisy fast. 60s TTL is the sweet spot: stale enough to win, fresh enough
// that users don't see misleading numbers in a status dashboard.
// Per-instance only (no Redis) — if you scale beyond one Node process,
// migrate to a shared store. Until then this is plenty.
const CACHE = new Map<string, { at: number; data: unknown }>()
const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 500
// The legacy presence flag is write-only in parts of the mobile stack, so this
// contract deliberately ignores it. A row is "fresh GPS" solely when its
// latest accepted coordinate falls inside this explicit evidence window.
const RECENT_GPS_THRESHOLD_SECONDS = 300
const RECENT_GPS_AGENT_LIMIT = 500

function setCache(key: string, data: unknown) {
  if (CACHE.size >= MAX_CACHE_ENTRIES) {
    const firstKey = CACHE.keys().next().value
    if (firstKey !== undefined) CACHE.delete(firstKey)
  }
  CACHE.set(key, { at: Date.now(), data })
}

function getCache(key: string): unknown | null {
  const hit = CACHE.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    CACHE.delete(key)
    return null
  }
  return hit.data
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  // Resolve on every request, before consulting the aggregate cache. Team and
  // reporting-line changes therefore cannot keep serving a former scope.
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (actor.role !== "ADMIN" && actor.scopedAgentIds === null) {
    // `null` is the tenant-wide sentinel and is valid only for MTM admins.
    // Treat any inconsistent resolver result as a fail-closed authorization
    // error instead of accidentally widening a bounded actor.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const scopedAgentIds = actor.role === "ADMIN" ? null : actor.scopedAgentIds
  const bounded = scopedAgentIds !== null
  const scopeIds = scopedAgentIds ? [...new Set(scopedAgentIds)] : []
  const agentScope: Prisma.MtmAgentWhereInput = bounded ? { id: { in: scopeIds } } : {}
  const agentLinkedScope = bounded ? { agentId: { in: scopeIds } } : {}
  const { searchParams } = new URL(req.url)
  const requestedPeriod = searchParams.get("period") ?? "today"
  const period = requestedPeriod === "week" || requestedPeriod === "month" ? requestedPeriod : "today"

  const scopeKey = bounded
    ? createHash("sha256").update([...scopeIds].sort().join("\0")).digest("hex").slice(0, 24)
    : "all"
  const cacheKey = `${orgId}:${scopeKey}:${period}`
  const cached = getCache(cacheKey)
  if (cached) {
    return NextResponse.json({ success: true, data: cached, cached: true })
  }

  try {
    const now = new Date()
    const mtmSettings = await getMtmSettings(orgId)
    const timezone = isValidTimezone(mtmSettings.timezone) ? mtmSettings.timezone : "UTC"
    const todayKey = currentDateKey(now, timezone)
    const recentGpsCutoff = new Date(now.getTime() - RECENT_GPS_THRESHOLD_SECONDS * 1_000)
    const today = localDateKeyToUtc(todayKey, timezone)
    const tomorrowKey = addDateKeyDays(todayKey, 1)
    const tomorrow = localDateKeyToUtc(tomorrowKey, timezone)

    let periodStartKey: string
    if (period === "week") {
      periodStartKey = addDateKeyDays(todayKey, -6)
    } else if (period === "month") {
      periodStartKey = `${todayKey.slice(0, 7)}-01`
    } else {
      periodStartKey = todayKey
    }
    // Date-only Prisma columns are stored as UTC date keys; activity
    // timestamps use real tenant-local midnight instants.
    const routePeriodRange = {
      gte: new Date(`${periodStartKey}T00:00:00.000Z`),
      lt: new Date(`${tomorrowKey}T00:00:00.000Z`),
    }
    const activityPeriodRange = {
      gte: localDateKeyToUtc(periodStartKey, timezone),
      lt: tomorrow,
    }

    const periodWhere: Prisma.MtmTaskWhereInput = {
      organizationId: orgId,
      createdAt: activityPeriodRange,
      deletedAt: null,
      ...agentLinkedScope,
    }
    const customerScope = customerScopeForActor(actor, today)

    const [
      totalAgents,
      activeAgents,
      todayRoutes,
      completedRoutes,
      offRouteAlerts,
      todayVisits,
      totalCustomers,
      pendingTasks,
      urgentTasks,
      unresolvedAlerts,
      recentVisits,
      activeAgentCandidatesRaw,
      completedTasks,
      totalTasks,
      avgVisitDuration,
      failedImports,
      openVisits,
      routeApprovalBacklog,
      customerApprovalBacklog,
    ] = await Promise.all([
      prisma.mtmAgent.count({ where: { organizationId: orgId, ...agentScope } }),
      prisma.mtmAgent.count({ where: { organizationId: orgId, status: "ACTIVE", ...agentScope } }),
      prisma.mtmRoute.count({ where: { organizationId: orgId, date: routePeriodRange, deletedAt: null, ...agentLinkedScope } }),
      prisma.mtmRoute.count({ where: { organizationId: orgId, date: routePeriodRange, status: "COMPLETED", deletedAt: null, ...agentLinkedScope } }),
      prisma.mtmAlert.count({ where: { organizationId: orgId, category: "WARNING", isResolved: false, ...agentLinkedScope } }),
      prisma.mtmVisit.count({ where: { organizationId: orgId, checkInAt: activityPeriodRange, deletedAt: null, ...agentLinkedScope } }),
      prisma.mtmCustomer.count({
        where: { organizationId: orgId, status: "ACTIVE", deletedAt: null, ...customerScope },
      }),
      prisma.mtmTask.count({ where: { organizationId: orgId, status: { in: ["PENDING", "IN_PROGRESS"] }, deletedAt: null, ...agentLinkedScope } }),
      prisma.mtmTask.count({ where: { organizationId: orgId, priority: "URGENT", status: { in: ["PENDING", "IN_PROGRESS"] }, deletedAt: null, ...agentLinkedScope } }),
      prisma.mtmAlert.count({ where: { organizationId: orgId, isResolved: false, ...agentLinkedScope } }),
      prisma.mtmVisit.findMany({
        where: { organizationId: orgId, deletedAt: null, ...agentLinkedScope },
        take: 10,
        orderBy: { checkInAt: "desc" },
        include: { agent: { select: { name: true } }, customer: { select: { name: true } } },
      }),
      prisma.mtmAgent.findMany({
        where: { organizationId: orgId, status: "ACTIVE", ...agentScope },
        orderBy: { id: "asc" },
        take: RECENT_GPS_AGENT_LIMIT + 1,
        select: { id: true, name: true },
      }),
      prisma.mtmTask.count({ where: { ...periodWhere, status: "COMPLETED" } }),
      prisma.mtmTask.count({ where: periodWhere }),
      prisma.mtmVisit.aggregate({
        where: { organizationId: orgId, checkInAt: activityPeriodRange, duration: { not: null }, deletedAt: null, ...agentLinkedScope },
        _avg: { duration: true },
      }),
      // Import jobs are initiated by web users and have no durable agent
      // attribution. Tenant admins retain the tenant-wide metric; bounded
      // actors get an explicit unavailable value plus scope metadata below.
      bounded
        ? Promise.resolve(null)
        : prisma.mtmImportJob.count({ where: { organizationId: orgId, status: { in: ["FAILED", "COMPLETED_WITH_ERRORS"] } } }),
      prisma.mtmVisit.count({ where: { organizationId: orgId, status: "CHECKED_IN", deletedAt: null, ...agentLinkedScope } }),
      prisma.mtmRouteChangeRequest.count({
        where: {
          organizationId: orgId,
          status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
          ...(bounded ? { requestedByAgentId: { in: scopeIds } } : {}),
        },
      }),
      prisma.mtmCustomerCreateRequest.count({
        where: {
          organizationId: orgId,
          status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
          ...(bounded ? { requestedByAgentId: { in: scopeIds } } : {}),
        },
      }),
    ])

    const routeCompletion = todayRoutes > 0 ? Math.round((completedRoutes / todayRoutes) * 100) : 0

    // The WHERE clauses above are the authorization boundary. Keep a small
    // fail-closed post-filter on the two name-bearing result sets as defense
    // in depth against future query refactors that accidentally widen them.
    const scopeIdSet = new Set(scopeIds)
    const gpsRosterTruncated = activeAgentCandidatesRaw.length > RECENT_GPS_AGENT_LIMIT
    const activeAgentCandidates = activeAgentCandidatesRaw.slice(0, RECENT_GPS_AGENT_LIMIT)
    const visibleActiveAgents = bounded
      ? activeAgentCandidates.filter((agent: ActiveAgentRow) => scopeIdSet.has(agent.id))
      : activeAgentCandidates
    const agentLocations = await prisma.mtmAgentLocation.findMany({
      where: {
        organizationId: orgId,
        agentId: { in: visibleActiveAgents.map((agent: ActiveAgentRow) => agent.id) },
        recordedAt: { gte: recentGpsCutoff },
      },
      orderBy: { recordedAt: "desc" },
      distinct: ["agentId"],
      select: { agentId: true, speed: true, recordedAt: true },
    })
    const agentLocationMap = Object.fromEntries(
      agentLocations
        .filter((location: AgentLocationLite) => location.recordedAt.getTime() >= recentGpsCutoff.getTime())
        .map((location: AgentLocationLite) => [location.agentId, location]),
    )

    const recentGpsAgents = visibleActiveAgents.filter((agent: ActiveAgentRow) => agentLocationMap[agent.id])
    const activeAgentsList = recentGpsAgents.map((a: ActiveAgentRow) => ({
      id: a.id,
      name: a.name,
      speed: agentLocationMap[a.id]?.speed ?? null,
      lastSeen: agentLocationMap[a.id]?.recordedAt ?? null,
    }))

    const avgRouteDuration = await prisma.mtmVisit.aggregate({
      where: { organizationId: orgId, checkInAt: activityPeriodRange, status: "CHECKED_OUT", duration: { not: null }, deletedAt: null, ...agentLinkedScope },
      _avg: { duration: true },
    })

    const payload = {
      generatedAt: now,
      timezone,
      scope: {
        semantics: "current primary-owner agent scope; null scope means tenant administrator",
        bounded,
        customerSemantics: bounded
          ? "active direct customer assignment or accessible route assignment"
          : "tenant-wide",
        omittedForBoundedScope: bounded ? ["failedImports"] : [],
      },
      totalAgents,
      activeAgents,
      recentGpsAgents: recentGpsAgents.length,
      gpsFreshnessThresholdSeconds: RECENT_GPS_THRESHOLD_SECONDS,
      gpsRosterTruncated,
      todayRoutes,
      completedRoutes,
      routeCompletion,
      offRouteAlerts,
      todayVisits,
      totalCustomers,
      pendingTasks,
      urgentTasks,
      unresolvedAlerts,
      failedImports,
      openVisits,
      approvalBacklog: routeApprovalBacklog + customerApprovalBacklog,
      avgVisitDuration: Math.round(avgVisitDuration._avg?.duration ?? 0),
      avgRouteDuration: Math.round(avgRouteDuration._avg?.duration ?? 0),
      totalWorkTime: Math.round((avgRouteDuration._avg?.duration ?? 0) * todayVisits / 60),
      activeAgentsList,
      recentVisits: recentVisits
        .filter((v: any) => !bounded || scopeIdSet.has(v.agentId))
        .map((v: any) => ({
          id: v.id,
          agent: v.agent.name,
          customer: v.customer.name,
          status: v.status,
          checkInAt: v.checkInAt,
          checkOutAt: v.checkOutAt,
          duration: v.duration,
        })),
    }
    setCache(cacheKey, payload)
    return NextResponse.json({ success: true, data: payload })
  } catch (e) {
    console.error("[MTM/dashboard GET]", e)
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 })
  }
})
