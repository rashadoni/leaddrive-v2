import { readAttendanceInstallationAttention } from "@/lib/mtm/attendance-installation-store"
import { attendanceReviewWhere } from "@/lib/mtm/attendance-request-review"
import { checkPermission, type Role } from "@/lib/permissions"
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
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import {
  MTM_ATTENTION_PEOPLE_SHOWN,
  MTM_NEXT_WORKDAY_LOOKAHEAD_DAYS,
  agentsWorkingOn,
  buildAttentionItems,
  buildNextWorkday,
  nextWorkingDateKey,
  olderOpenAlertWhere,
  openContactCreateRequestWhere,
  openCustomerLocationRequestWhere,
  openCustomerCreateRequestWhere,
  openRouteChangeRequestWhere,
  pendingPhotoWhere,
  routeAwaitingPublishWhere,
  summarizeByAgent,
  weekStartKey,
  weekWorkingDays,
  type AttentionAgentFilter,
  type MtmPanelAttention,
} from "@/lib/mtm/panel-attention"

/**
 * GET /api/v1/mtm/week/attention — «Ждёт решения» on the Panel.
 *
 * Counts of lists that already exist (see src/lib/mtm/panel-attention.ts) for
 * the caller's own scope and the Panel's region/team filters, with the names
 * of the agents the rows belong to — the same names the lists themselves
 * show — and the organization's working days for the week strip. No request
 * text, no customer names, no coordinates.
 *
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

type AgentGroup = { agentId: string; count: number; date: Date | null }

function countOf(row: { _count?: { _all?: number } | null }): number {
  return row._count?._all ?? 0
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
  const monday = weekStartKey(today)
  const lookaheadEnd = addDateKeyDays(today, MTM_NEXT_WORKDAY_LOOKAHEAD_DAYS + 1)

  // The calendar is the organization's own and names nobody: every reader of
  // the Panel may know which days it works.
  const calendarRows = await prisma.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      date: { gte: new Date(`${monday}T00:00:00.000Z`), lt: new Date(`${lookaheadEnd}T00:00:00.000Z`) },
    },
    select: { id: true, date: true, kind: true, name: true, teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true },
  })
  const overrides = calendarRows as WorkCalendarOverride[]
  const empty: MtmPanelAttention = {
    timezone,
    today,
    generatedAt: generatedAt.toISOString(),
    todayIsWorkingDay: resolveWorkCalendarDay({ date: today, overrides }).isWorkingDay,
    week: weekWorkingDays(today, overrides),
    items: [],
    nextWorkday: null,
  }

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
      select: { id: true, name: true, teamId: true },
    }),
  ])
  const agentIds: AttentionAgentFilter = filterAgents ? filterAgents.map((agent: { id: string }) => agent.id) : scopeIds
  const fieldAgents = fieldAgentsRaw as Array<{ id: string; name: string; teamId: string | null }>

  // Off means no attendance query and no new item in this legacy response.
  const attendanceGroups = settings.attendanceEnabled === true && auth.principalType === "session" && checkPermission(auth.role as Role, "mtm", "write")
    ? await prisma.mtmHrmRequest.groupBy({ by: ["agentId"],
      where: { ...attendanceReviewWhere(auth.orgId, auth.userId, { ...actor, scopedAgentIds: agentIds === null ? null : [...agentIds] }), status: "PENDING" },
      _count: { _all: true }, _min: { submittedAt: true },
    }) : []
  const attendanceSummary = summarizeByAgent(attendanceGroups.map((row) => ({ agentId: row.agentId, count: row._count._all, date: row._min.submittedAt })), "earliest")

  const installationGroups = settings.attendanceEnabled === true && auth.principalType === "session" && checkPermission(auth.role as Role, "mtm", "write")
    ? await readAttendanceInstallationAttention({ organizationId: auth.orgId, userId: auth.userId, principalType: "session" }, agentIds) : []
  const installationSummary = summarizeByAgent(installationGroups, "earliest")

  const todayStart = localDateKeyToUtc(today, timezone)

  const [locationRequests, contactRequests, customerRequests, routeChanges, drafts, alerts, photos] = await Promise.all([
    prisma.mtmCustomerLocationRequest.groupBy({
      by: ["requestedByAgentId"],
      where: openCustomerLocationRequestWhere(auth.orgId, agentIds) as Prisma.MtmCustomerLocationRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true },
    }),
    prisma.mtmContactCreateRequest.groupBy({
      by: ["requestedByAgentId"],
      where: openContactCreateRequestWhere(auth.orgId, agentIds) as Prisma.MtmContactCreateRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true },
    }),
    prisma.mtmCustomerCreateRequest.groupBy({
      by: ["requestedByAgentId"],
      where: openCustomerCreateRequestWhere(auth.orgId, agentIds) as Prisma.MtmCustomerCreateRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true, createdAt: true },
    }),
    prisma.mtmRouteChangeRequest.groupBy({
      by: ["requestedByAgentId"],
      where: openRouteChangeRequestWhere(auth.orgId, agentIds) as Prisma.MtmRouteChangeRequestWhereInput,
      _count: { _all: true },
      _min: { submittedAt: true },
    }),
    prisma.mtmRoute.groupBy({
      by: ["agentId"],
      where: routeAwaitingPublishWhere(auth.orgId, agentIds, today) as Prisma.MtmRouteWhereInput,
      _count: { _all: true },
      _min: { date: true },
    }),
    prisma.mtmAlert.groupBy({
      by: ["type"],
      where: olderOpenAlertWhere(auth.orgId, agentIds, todayStart) as Prisma.MtmAlertWhereInput,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.mtmPhoto.aggregate({
      where: pendingPhotoWhere(auth.orgId, agentIds) as Prisma.MtmPhotoWhereInput,
      _count: { _all: true },
      _min: { createdAt: true },
    }),
  ])

  type RequestGroup = { requestedByAgentId: string; _count?: { _all?: number } | null; _min?: { submittedAt?: Date | null; createdAt?: Date | null } | null }
  const byRequester = (rows: unknown, date: (row: RequestGroup) => Date | null | undefined): AgentGroup[] =>
    (rows as RequestGroup[]).map((row) => ({ agentId: row.requestedByAgentId, count: countOf(row), date: date(row) ?? null }))
  const locationSummary = summarizeByAgent(byRequester(locationRequests, (row) => row._min?.submittedAt), "earliest")
  const contactSummary = summarizeByAgent(byRequester(contactRequests, (row) => row._min?.submittedAt), "earliest")
  // Never submitted: such a request has waited since it was written.
  const customerSummary = summarizeByAgent(byRequester(customerRequests, (row) => row._min?.submittedAt ?? row._min?.createdAt), "earliest")
  const routeChangeSummary = summarizeByAgent(byRequester(routeChanges, (row) => row._min?.submittedAt), "earliest")
  const draftSummary = summarizeByAgent(
    (drafts as Array<{ agentId: string; _count?: { _all?: number } | null; _min?: { date?: Date | null } | null }>)
      .map((row) => ({ agentId: row.agentId, count: countOf(row), date: row._min?.date ?? null })),
    "earliest",
  )
  const alertGroups = alerts as Array<{ type: string; _count?: { _all?: number } | null; _max?: { createdAt?: Date | null } | null }>
  const alertCount = alertGroups.reduce((sum, row) => sum + countOf(row), 0)
  const newestAlert = alertGroups.reduce<Date | null>((newest, row) => {
    const at = row._max?.createdAt ?? null
    return at && (!newest || at > newest) ? at : newest
  }, null)

  // One read for every name a row spells out.
  const namedIds = [...new Set([installationSummary, attendanceSummary, locationSummary, contactSummary, customerSummary, routeChangeSummary, draftSummary]
    .flatMap((summary) => summary.agentIds.slice(0, MTM_ATTENTION_PEOPLE_SHOWN)))]
  const namedAgents = namedIds.length > 0
    ? await prisma.mtmAgent.findMany({ where: { organizationId: auth.orgId, id: { in: namedIds } }, select: { id: true, name: true } })
    : []
  const agentNames = new Map((namedAgents as Array<{ id: string; name: string }>).map((agent) => [agent.id, agent.name]))

  const localDay = (value: Date | null | undefined) => (value ? dateInputValueInTimezone(value, timezone) : null)
  const items = buildAttentionItems([
    { kind: "attendanceInstallations", count: installationSummary.count, date: localDay(installationSummary.date), agentIds: installationSummary.agentIds },
    { kind: "attendanceRequests", count: attendanceSummary.count, date: localDay(attendanceSummary.date), agentIds: attendanceSummary.agentIds },
    {
      kind: "customerLocationRequests",
      count: locationSummary.count,
      date: localDay(locationSummary.date),
      agentIds: locationSummary.agentIds,
      since: locationSummary.date,
    },
    { kind: "contactCreateRequests", count: contactSummary.count, date: localDay(contactSummary.date), agentIds: contactSummary.agentIds },
    { kind: "customerCreateRequests", count: customerSummary.count, date: localDay(customerSummary.date), agentIds: customerSummary.agentIds },
    { kind: "routeChangeRequests", count: routeChangeSummary.count, date: localDay(routeChangeSummary.date), agentIds: routeChangeSummary.agentIds },
    // A route's date is a calendar day already, stored at UTC midnight.
    { kind: "routesAwaitingPublish", count: draftSummary.count, date: draftSummary.date ? utcDateKey(draftSummary.date) : null, agentIds: draftSummary.agentIds },
    {
      kind: "olderAlerts",
      count: alertCount,
      date: localDay(newestAlert),
      types: alertGroups.map((row) => ({ type: row.type, count: countOf(row) })),
    },
    { kind: "photosPendingReview", count: countOf(photos), date: localDay(photos._min?.createdAt) },
  ], agentNames)

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
