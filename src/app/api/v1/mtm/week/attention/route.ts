import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { checkRateLimit } from "@/lib/rate-limit"
import { OPERATIONAL_WEEK_LIMITS } from "@/lib/mtm/operational-week"
import type { WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import {
  MTM_NEXT_WORKDAY_LOOKAHEAD_DAYS,
  agentsWorkingOn,
  buildAttentionItems,
  buildNextWorkday,
  nextWorkingDateKey,
  olderOpenAlertWhere,
  openContactCreateRequestWhere,
  openCustomerCreateRequestWhere,
  openRouteChangeRequestWhere,
  routeAwaitingPublishWhere,
  type AttentionAgentFilter,
  type MtmPanelAttention,
} from "@/lib/mtm/panel-attention"

/**
 * GET /api/v1/mtm/week/attention — «Ждёт решения» on the Panel.
 *
 * Counts of lists that already exist (see src/lib/mtm/panel-attention.ts) for
 * the caller's own scope and the Panel's region/team filters. Only counts and
 * calendar days leave the server: no names, no request text, no coordinates.
 * An agent reviews nothing, so an agent gets an empty answer rather than a
 * refusal — the Panel is their screen too.
 */

const ATTENTION_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }

function trimmedParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim().slice(0, 100) ?? ""
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const rateLimitKey = `mtm-week-attention:${auth.orgId}:${auth.principal}:${auth.userId || auth.agentId || "principal"}`
  if (!checkRateLimit(rateLimitKey, ATTENTION_RATE_LIMIT)) {
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
  const generatedAt = new Date()
  const today = currentDateKey(generatedAt, timezone)
  const empty: MtmPanelAttention = { timezone, today, generatedAt: generatedAt.toISOString(), items: [], nextWorkday: null }

  // The same people who may open the queues these rows lead to.
  if (!canManageFieldMasterData(actor)) return NextResponse.json({ success: true, data: empty })
  // `null` is the tenant-wide sentinel and is valid only for MTM admins.
  if (actor.role !== "ADMIN" && actor.scopedAgentIds === null) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }
  const scopeIds = actor.role === "ADMIN" ? null : [...new Set(actor.scopedAgentIds)]

  const { searchParams } = new URL(req.url)
  const regionId = trimmedParam(searchParams, "regionId")
  const teamId = trimmedParam(searchParams, "teamId")
  const filtered = Boolean(regionId || teamId)

  // Under a region or team filter the block counts that team's agents only,
  // whatever their status: a request outlives the card of whoever sent it.
  const agentWhere: Prisma.MtmAgentWhereInput = {
    organizationId: auth.orgId,
    ...(scopeIds === null ? {} : { id: { in: scopeIds } }),
    ...(teamId ? { teamId } : {}),
    ...(regionId ? { team: { is: { regionId } } } : {}),
  }
  const [filterAgents, fieldAgentsRaw] = await Promise.all([
    filtered
      ? prisma.mtmAgent.findMany({ where: agentWhere, select: { id: true }, take: OPERATIONAL_WEEK_LIMITS.filterAgents })
      : Promise.resolve(null),
    // Who is expected to hold a route: the field role, and only active cards.
    prisma.mtmAgent.findMany({
      where: { ...agentWhere, status: "ACTIVE", role: "AGENT" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: OPERATIONAL_WEEK_LIMITS.filterAgents,
      select: { id: true, teamId: true },
    }),
  ])
  const agentIds: AttentionAgentFilter = filterAgents ? filterAgents.map((agent: { id: string }) => agent.id) : scopeIds
  const fieldAgents = fieldAgentsRaw as Array<{ id: string; teamId: string | null }>

  const todayStart = localDateKeyToUtc(today, timezone)
  const tomorrowKey = addDateKeyDays(today, 1)
  const lookaheadEnd = addDateKeyDays(today, MTM_NEXT_WORKDAY_LOOKAHEAD_DAYS + 1)

  const [contactRequests, customerRequests, routeChanges, drafts, alerts, calendarRows] = await Promise.all([
    prisma.mtmContactCreateRequest.aggregate({
      where: openContactCreateRequestWhere(auth.orgId, agentIds) as Prisma.MtmContactCreateRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true },
    }),
    prisma.mtmCustomerCreateRequest.aggregate({
      where: openCustomerCreateRequestWhere(auth.orgId, agentIds) as Prisma.MtmCustomerCreateRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true, createdAt: true },
    }),
    prisma.mtmRouteChangeRequest.aggregate({
      where: openRouteChangeRequestWhere(auth.orgId, agentIds) as Prisma.MtmRouteChangeRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true },
    }),
    prisma.mtmRoute.aggregate({
      where: routeAwaitingPublishWhere(auth.orgId, agentIds, today) as Prisma.MtmRouteWhereInput,
      _count: { _all: true },
      _min: { date: true },
    }),
    prisma.mtmAlert.aggregate({
      where: olderOpenAlertWhere(auth.orgId, agentIds, todayStart) as Prisma.MtmAlertWhereInput,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    fieldAgents.length > 0
      ? prisma.mtmWorkCalendarDay.findMany({
          where: {
            organizationId: auth.orgId,
            deletedAt: null,
            date: { gte: new Date(`${tomorrowKey}T00:00:00.000Z`), lt: new Date(`${lookaheadEnd}T00:00:00.000Z`) },
          },
          select: { id: true, date: true, kind: true, name: true, teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true },
        })
      : Promise.resolve([]),
  ])

  const localDay = (value: Date | null | undefined) => (value ? dateInputValueInTimezone(value, timezone) : null)
  const countOf = (row: { _count?: { _all?: number } | null }) => row._count?._all ?? 0
  const items = buildAttentionItems([
    { kind: "contactCreateRequests", count: countOf(contactRequests), date: localDay(contactRequests._min?.submittedAt) },
    {
      kind: "customerCreateRequests",
      count: countOf(customerRequests),
      date: localDay(customerRequests._min?.submittedAt ?? customerRequests._min?.createdAt),
    },
    { kind: "routeChangeRequests", count: countOf(routeChanges), date: localDay(routeChanges._min?.submittedAt) },
    // A route's date is a calendar day already, stored at UTC midnight.
    { kind: "routesAwaitingPublish", count: countOf(drafts), date: drafts._min?.date ? utcDateKey(drafts._min.date) : null },
    { kind: "olderAlerts", count: countOf(alerts), date: localDay(alerts._max?.createdAt) },
  ])

  const overrides = calendarRows as WorkCalendarOverride[]
  const nextDate = fieldAgents.length > 0 ? nextWorkingDateKey(today, overrides) : null
  const working = nextDate ? agentsWorkingOn(fieldAgents, nextDate, overrides) : []
  const routed = nextDate && working.length > 0
    ? await prisma.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: { in: working.map((agent) => agent.id) },
          date: { gte: new Date(`${nextDate}T00:00:00.000Z`), lt: new Date(`${addDateKeyDays(nextDate, 1)}T00:00:00.000Z`) },
          deletedAt: null,
          publishedVersion: { not: null },
        },
        distinct: ["agentId"],
        select: { agentId: true },
      })
    : []
  const workingIds = new Set(working.map((agent) => agent.id))
  const nextWorkday = buildNextWorkday({
    date: nextDate,
    agents: working,
    // Defense in depth: only ids that were asked for count as «has a route».
    agentIdsWithRoute: new Set((routed as Array<{ agentId: string }>).map((route) => route.agentId).filter((id) => workingIds.has(id))),
  })

  const data: MtmPanelAttention = { ...empty, items, nextWorkday }
  return NextResponse.json({ success: true, data })
})
