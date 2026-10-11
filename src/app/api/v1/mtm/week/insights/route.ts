import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData, contactScopeForActor, customerScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { checkRateLimit } from "@/lib/rate-limit"
import { OPERATIONAL_WEEK_LIMITS } from "@/lib/mtm/operational-week"
import { MTM_CONTACT_CLASS_PRIORITY } from "@/lib/mtm/contact-classes"
import { weekStartKey } from "@/lib/mtm/panel-attention"
import {
  MTM_SHORT_VISIT_MINUTES,
  buildHomeBase,
  buildHomeQuality,
  buildHomeSetup,
  recentVisitFlag,
  type HomeBaseGroup,
  type HomeQualityVisit,
  type MtmHomeInsights,
} from "@/lib/mtm/home-insights"

/**
 * GET /api/v1/mtm/week/insights — the lower row of the home screen.
 *
 * The client base reached this month, this week's visits judged, what is left
 * to set up, and the last visits. Read once when the screen opens — none of
 * it moves by the minute. Scoped like the lists it summarizes: the clients a
 * manager may open (`contactScopeForActor` / `customerScopeForActor`) and the
 * visits of their agents. Setup is the organization's own and goes to its
 * administrator only.
 */

const INSIGHTS_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 }
/** Visits judged for place; beyond it the week is too large to judge row by row here. */
const QUALITY_VISIT_LIMIT = 3_000
const RECENT_VISITS = 3

function trimmedParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim().slice(0, 100) ?? ""
}

type CountGroup = { _count?: { _all?: number } | null }
const countOf = (row: CountGroup) => row._count?._all ?? 0

function groups<Row extends CountGroup>(totals: readonly Row[], visited: readonly Row[], key: (row: Row) => string | null): HomeBaseGroup[] {
  const seen = new Map<string, number>()
  for (const row of visited) {
    const name = key(row)
    if (name !== null) seen.set(name, (seen.get(name) ?? 0) + countOf(row))
  }
  const merged = new Map<string, HomeBaseGroup>()
  for (const row of totals) {
    const name = key(row)
    if (name === null) continue
    const current = merged.get(name) ?? { key: name, total: 0, visited: 0 }
    current.total += countOf(row)
    merged.set(name, current)
  }
  for (const group of merged.values()) group.visited = seen.get(group.key) ?? 0
  return [...merged.values()]
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const rateLimitKey = `mtm-week-insights:${auth.orgId}:${auth.principal}:${auth.userId || auth.agentId || "principal"}`
  if (!checkRateLimit(rateLimitKey, INSIGHTS_RATE_LIMIT)) {
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

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const now = new Date()
  const today = currentDateKey(now, timezone)
  const monthStart = `${today.slice(0, 8)}01`
  const weekStart = weekStartKey(today)
  const empty: MtmHomeInsights = { timezone, today, monthStart, weekStart, base: null, quality: null, setup: [], recentVisits: [] }

  // The row is a manager's: an agent's own screen has no team to summarize.
  if (!canManageFieldMasterData(actor)) return NextResponse.json({ success: true, data: empty })
  // `null` is the tenant-wide sentinel and is valid only for MTM admins.
  if (actor.role !== "ADMIN" && actor.scopedAgentIds === null) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const regionId = trimmedParam(searchParams, "regionId")
  const teamId = trimmedParam(searchParams, "teamId")
  const filtered = Boolean(regionId || teamId)
  const ownIds = actor.role === "ADMIN" ? null : [...new Set(actor.scopedAgentIds)]
  const filterAgents = filtered
    ? await prisma.mtmAgent.findMany({
        where: {
          organizationId: auth.orgId,
          ...(ownIds === null ? {} : { id: { in: ownIds } }),
          ...(teamId ? { teamId } : {}),
          ...(regionId ? { team: { is: { regionId } } } : {}),
        },
        select: { id: true },
        take: OPERATIONAL_WEEK_LIMITS.filterAgents,
      })
    : null
  // Whose clients and whose visits: the reader's own agents, narrowed by the screen's filters.
  const agentIds = filterAgents ? (filterAgents as Array<{ id: string }>).map((agent) => agent.id) : ownIds
  // Under a filter even an administrator sees that team's clients only.
  const scopeActor: MtmRouteActor = agentIds === null ? actor : { agentId: null, role: "MANAGER", scopedAgentIds: agentIds }
  const byAgents = agentIds === null ? {} : { agentId: { in: agentIds } }

  const todayDate = new Date(`${today}T00:00:00.000Z`)
  const visitThisMonth = {
    deletedAt: null,
    status: { not: "CANCELLED" as const },
    checkInAt: { gte: localDateKeyToUtc(monthStart, timezone) },
    ...byAgents,
  }
  const contactWhere: Prisma.MtmContactWhereInput = { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE", ...contactScopeForActor(scopeActor, todayDate) }
  const customerWhere: Prisma.MtmCustomerWhereInput = { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE", ...customerScopeForActor(scopeActor, todayDate) }

  const contactTotals = settings.fieldContactsEnabled
    ? await prisma.mtmContact.groupBy({ by: ["category", "specialtyName"], where: contactWhere, _count: { _all: true } })
    : []
  type ContactGroup = CountGroup & { category: string; specialtyName: string | null }
  type CustomerGroup = CountGroup & { category: string; objectType: string }
  // Doctors when the organization visits doctors; institutions otherwise (a
  // distributor's agents visit shops, not people).
  const subject = (contactTotals as ContactGroup[]).some((row) => countOf(row) > 0) ? "contacts" as const : "customers" as const

  const weekVisitWhere: Prisma.MtmVisitWhereInput = {
    organizationId: auth.orgId,
    deletedAt: null,
    status: { not: "CANCELLED" },
    checkInAt: { gte: localDateKeyToUtc(weekStart, timezone) },
    ...byAgents,
  }
  const isAdmin = actor.role === "ADMIN" && !filtered

  const [visitedGroups, customerTotals, weekVisits, recent, customersTotal, customersWithoutPin, coveragePolicies] = await Promise.all([
    subject === "contacts"
      ? prisma.mtmContact.groupBy({ by: ["category", "specialtyName"], where: { ...contactWhere, visits: { some: visitThisMonth } }, _count: { _all: true } })
      : prisma.mtmCustomer.groupBy({ by: ["category", "objectType"], where: { ...customerWhere, visits: { some: visitThisMonth } }, _count: { _all: true } }),
    subject === "customers"
      ? prisma.mtmCustomer.groupBy({ by: ["category", "objectType"], where: customerWhere, _count: { _all: true } })
      : Promise.resolve([]),
    prisma.mtmVisit.findMany({
      where: weekVisitWhere,
      orderBy: [{ checkInAt: "desc" }, { id: "desc" }],
      take: QUALITY_VISIT_LIMIT,
      select: {
        status: true,
        checkInAt: true,
        duration: true,
        checkInLat: true,
        checkInLng: true,
        checkOutLat: true,
        checkOutLng: true,
        checkInCustomerLat: true,
        checkInCustomerLng: true,
        checkInGeofenceRadius: true,
        customer: { select: { latitude: true, longitude: true, geofenceRadius: true } },
        // One row is enough to know a visit has a photo.
        photos: { select: { id: true }, take: 1 },
      },
    }),
    prisma.mtmVisit.findMany({
      where: { organizationId: auth.orgId, deletedAt: null, status: { not: "CANCELLED" }, ...byAgents },
      orderBy: [{ checkInAt: "desc" }, { id: "desc" }],
      take: RECENT_VISITS,
      select: { id: true, status: true, checkInAt: true, duration: true, customer: { select: { name: true } }, agent: { select: { name: true } } },
    }),
    // Setup is the organization's own: counted for its administrator, across the whole organization.
    isAdmin ? prisma.mtmCustomer.count({ where: { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE" } }) : Promise.resolve(0),
    isAdmin
      ? prisma.mtmCustomer.count({ where: { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE", OR: [{ latitude: null }, { longitude: null }] } })
      : Promise.resolve(0),
    isAdmin ? prisma.mtmCoveragePolicy.count({ where: { organizationId: auth.orgId } }) : Promise.resolve(1),
  ])

  const totals = subject === "contacts" ? contactTotals as ContactGroup[] : customerTotals as CustomerGroup[]
  const visited = visitedGroups as Array<ContactGroup | CustomerGroup>
  const secondaryKey = (row: ContactGroup | CustomerGroup) =>
    "specialtyName" in row ? (row.specialtyName?.trim() || null) : (row as CustomerGroup).objectType
  const base = buildHomeBase({
    subject,
    byClass: groups(totals as Array<ContactGroup | CustomerGroup>, visited, (row) => row.category),
    secondary: groups(totals as Array<ContactGroup | CustomerGroup>, visited, secondaryKey),
    classOrder: MTM_CONTACT_CLASS_PRIORITY,
  })

  const longMinutes = Math.max(MTM_SHORT_VISIT_MINUTES + 1, settings.autoCheckoutMinutes)
  type WeekVisit = Omit<HomeQualityVisit, "photoCount"> & { photos: unknown[] }
  const judged = (weekVisits as WeekVisit[]).map((visit): HomeQualityVisit => ({ ...visit, photoCount: visit.photos.length }))
  const quality = judged.length > 0
    ? buildHomeQuality(judged, { now, organizationRadius: settings.geofenceRadius, longMinutes })
    : null

  const contactsTotal = subject === "contacts" ? (contactTotals as ContactGroup[]).reduce((sum, row) => sum + countOf(row), 0) : 0
  const classesInUse = new Set((contactTotals as ContactGroup[]).filter((row) => countOf(row) > 0).map((row) => row.category)).size
  const setup = isAdmin
    ? buildHomeSetup({
        customersTotal: customersTotal as number,
        customersWithoutPin: customersWithoutPin as number,
        contactsTotal,
        contactClassesInUse: classesInUse,
        fieldContactsEnabled: settings.fieldContactsEnabled,
        coveragePolicies: coveragePolicies as number,
      })
    : []

  type RecentVisit = { id: string; status: string; checkInAt: Date; duration: number | null; customer: { name: string | null } | null; agent: { name: string | null } | null }
  const data: MtmHomeInsights = {
    ...empty,
    base,
    quality,
    setup,
    recentVisits: (recent as RecentVisit[]).map((visit) => ({
      id: visit.id,
      at: visit.checkInAt.toISOString(),
      customerName: visit.customer?.name ?? null,
      agentName: visit.agent?.name ?? null,
      durationMinutes: visit.status === "CHECKED_IN" ? null : visit.duration,
      flag: recentVisitFlag(visit, { longMinutes }),
    })),
  }
  return NextResponse.json({ success: true, data })
})
