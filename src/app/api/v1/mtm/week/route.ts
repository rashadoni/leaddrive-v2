import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { canReviewMtmRouteRequest, resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone, dateInputValueInTimezone } from "@/lib/timezone"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { classifyGpsFreshness, explainMissingLocation, mapWorkdayState } from "@/lib/mtm/live-location"
import { checkRateLimit } from "@/lib/rate-limit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import {
  OPERATIONAL_WEEK_LIMITS,
  assignmentIntersectsRouteDay,
  availableWorkdayActions,
  latestOperationalSourceAt,
  matchOperationalVisit,
  operationalPointState,
  operationalWeekSnapshotId,
  parseOperationalWeekDays,
  participantAtVisitTime,
  resolveOperationalWeekWindow,
  workedSeconds,
  type OperationalVisitEvidence,
} from "@/lib/mtm/operational-week"
import { buildOperationalTaskQueue } from "@/lib/mtm/operational-task-queue"

const PENDING_PLAN_CHANGE_STATUSES = ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] as const
const VISIBLE_PLAN_CHANGE_STATUSES = [
  ...PENDING_PLAN_CHANGE_STATUSES,
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const
const ACTIVE_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "OVERDUE"] as const
const WEEK_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 }

const operationalTaskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  scheduledStartAt: true,
  dueDate: true,
  completedAt: true,
  returnReason: true,
  version: true,
  customerId: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
} satisfies Prisma.MtmTaskSelect

const agentSelect = {
  id: true,
  name: true,
  role: true,
  teamId: true,
  lastSeenAt: true,
  team: {
    select: {
      id: true,
      name: true,
      regionId: true,
      region: { select: { id: true, name: true } },
    },
  },
} as const

type AgentRow = Prisma.MtmAgentGetPayload<{ select: typeof agentSelect }>

function denied(code: string, status = 403) {
  return NextResponse.json({
    error: status === 404 ? "Not found" : "Forbidden",
    code,
  }, { status })
}

async function workforceEnabled(organizationId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    return Boolean(organization && isTenantCapabilityEnabled("workforce-hrm", organization))
  } catch (error) {
    // Week is a mixed Route + Workforce compatibility read. Route facts stay
    // useful, but unverified Workforce facts and actions must fail closed.
    console.warn("[MTM/week GET] Workforce capability lookup failed", error)
    return false
  }
}

function trimmedParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim().slice(0, 100) ?? ""
}

function scopedAgentWhere(
  organizationId: string,
  actor: MtmRouteActor,
  regionId: string,
  teamId: string,
): Prisma.MtmAgentWhereInput {
  return {
    organizationId,
    status: "ACTIVE",
    ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }),
    ...(teamId ? { teamId } : {}),
    ...(regionId ? { team: { is: { regionId } } } : {}),
  }
}

function filtersFromAgents(
  rows: readonly AgentRow[],
  selected: { regionId: string; teamId: string; agentId: string | null },
  truncated: boolean,
) {
  const regions = new Map<string, { id: string; name: string }>()
  const teams = new Map<string, { id: string; name: string; regionId: string | null }>()
  for (const row of rows) {
    if (row.team) {
      teams.set(row.team.id, { id: row.team.id, name: row.team.name, regionId: row.team.regionId })
      if (row.team.region) regions.set(row.team.region.id, row.team.region)
    }
  }
  return {
    selected,
    regions: [...regions.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    teams: [...teams.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    agents: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      teamId: row.teamId,
      regionId: row.team?.regionId ?? null,
    })),
    truncated,
    limit: OPERATIONAL_WEEK_LIMITS.filterAgents,
  }
}

function includeSelectedFilterAgent(rows: readonly AgentRow[], selected: AgentRow): AgentRow[] {
  if (rows.some((row) => row.id === selected.id)) return [...rows]
  const retained = rows.length >= OPERATIONAL_WEEK_LIMITS.filterAgents
    ? rows.slice(0, OPERATIONAL_WEEK_LIMITS.filterAgents - 1)
    : [...rows]
  return [...retained, selected]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

async function loadFilterAgents(
  organizationId: string,
  actor: MtmRouteActor,
  regionId: string,
  teamId: string,
): Promise<{ rows: AgentRow[]; truncated: boolean }> {
  const raw = await prisma.mtmAgent.findMany({
    where: scopedAgentWhere(organizationId, actor, regionId, teamId),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: OPERATIONAL_WEEK_LIMITS.filterAgents + 1,
    select: agentSelect,
  })
  return {
    rows: raw.slice(0, OPERATIONAL_WEEK_LIMITS.filterAgents),
    truncated: raw.length > OPERATIONAL_WEEK_LIMITS.filterAgents,
  }
}

function routeDateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function sourceVisit(
  visit: OperationalVisitEvidence & { notes?: string | null; resultNotes?: string | null },
  match: string,
) {
  return {
    source: "VISIT" as const,
    match,
    visitId: visit.id,
    status: visit.status,
    checkInAt: visit.checkInAt,
    checkOutAt: visit.checkOutAt,
    reason: visit.resultNotes ?? visit.notes ?? null,
  }
}

function publicVisit(visit: {
  id: string
  customerId: string
  contactId: string | null
  routeId: string | null
  routePointId: string | null
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  outcome: unknown
  notes: string | null
  resultNotes: string | null
  customer: unknown
  contact: unknown
  attribution: "PRIMARY" | "PARTICIPANT"
}) {
  return {
    id: visit.id,
    customerId: visit.customerId,
    contactId: visit.contactId,
    routeId: visit.routeId,
    routePointId: visit.routePointId,
    status: visit.status,
    checkInAt: visit.checkInAt,
    checkOutAt: visit.checkOutAt,
    outcome: visit.outcome,
    notes: visit.notes,
    resultNotes: visit.resultNotes,
    customer: visit.customer,
    contact: visit.contact,
    attribution: visit.attribution,
  }
}

export const GET = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const rateLimitKey = `mtm-week:${auth.orgId}:${auth.principal}:${auth.userId || auth.agentId || "principal"}`
  if (!checkRateLimit(rateLimitKey, WEEK_RATE_LIMIT)) {
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
  if (!actor) return denied("MTM_WEEK_ACTOR_NOT_FOUND")
  const canReadWorkforce = await workforceEnabled(auth.orgId)

  const { searchParams } = new URL(req.url)
  const regionId = trimmedParam(searchParams, "regionId")
  const teamId = trimmedParam(searchParams, "teamId")
  const requestedAgentId = trimmedParam(searchParams, "agentId")
  const requestedDays = parseOperationalWeekDays(searchParams.get("days"))
  if (!requestedDays) {
    return NextResponse.json({
      error: "days must be one of 1, 5 or 7",
      code: "MTM_WEEK_DAYS_INVALID",
    }, { status: 400 })
  }

  if (actor.role === "AGENT" && requestedAgentId && requestedAgentId !== actor.agentId) {
    return denied("MTM_WEEK_AGENT_NOT_FOUND", 404)
  }
  if (actor.role === "AGENT" && !actor.agentId) return denied("MTM_WEEK_ACTOR_NOT_FOUND")
  const selectedAgentId = actor.role === "AGENT" ? actor.agentId : requestedAgentId || null

  // Managers receive an atomic, current-scope picker bootstrap. No route,
  // visit, workday, task, change, or telemetry facts are read in this mode.
  if (!selectedAgentId) {
    const [settings, roster] = await Promise.all([
      getMtmSettings(auth.orgId),
      loadFilterAgents(auth.orgId, actor, regionId, teamId),
    ])
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const generatedAt = new Date()
    const today = currentDateKey(generatedAt, timezone)
    const filters = filtersFromAgents(roster.rows, {
      regionId,
      teamId,
      agentId: null,
    }, roster.truncated)
    return NextResponse.json({
      success: true,
      data: {
        mode: "FILTERS_ONLY",
        protocolVersion: 1,
        selectionRequired: true,
        timezone,
        today,
        filters,
        generatedAt,
        lastSourceAt: null,
        snapshotId: operationalWeekSnapshotId({ mode: "FILTERS_ONLY", timezone, filters }),
        completeness: {
          authoritative: !roster.truncated,
          truncatedSources: roster.truncated ? ["FILTER_AGENTS"] : [],
        },
        capabilities: { workday: { enabled: canReadWorkforce } },
      },
    })
  }

  if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(selectedAgentId)) {
    return denied("MTM_WEEK_AGENT_NOT_FOUND", 404)
  }

  // Resolve the exact selected employee through the fresh actor scope and
  // optional hierarchy filters before any week fact query is allowed to run.
  const selectedAgent = await prisma.mtmAgent.findFirst({
    where: {
      AND: [
        scopedAgentWhere(auth.orgId, actor, regionId, teamId),
        { id: selectedAgentId },
      ],
    },
    select: agentSelect,
  }) as AgentRow | null
  if (!selectedAgent) return denied("MTM_WEEK_AGENT_NOT_FOUND", 404)

  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const maxAccuracyMeters = Math.min(1_000, Math.max(5, settings.historyMaxAccuracyMeters))
  const generatedAt = new Date()
  const today = currentDateKey(generatedAt, timezone)
  const anchor = searchParams.get("anchor") ?? today
  const window = resolveOperationalWeekWindow(anchor, requestedDays, timezone)
  if (!window) {
    return NextResponse.json({
      error: "anchor must be a valid YYYY-MM-DD date",
      code: "MTM_WEEK_ANCHOR_INVALID",
    }, { status: 400 })
  }

  const broadAssignment = {
    agentId: selectedAgent.id,
    role: { not: "OBSERVER" as const },
    assignedAt: { lt: window.activityEnd },
    OR: [
      { removedAt: null },
      { removedAt: { gt: window.activityStart } },
    ],
  }
  const routeScope = {
    OR: [
      { agentId: selectedAgent.id },
      { assignments: { some: broadAssignment } },
    ],
  }
  const participantScope = {
    agentId: selectedAgent.id,
    role: { not: "OBSERVER" as const },
    joinedAt: { lt: window.activityEnd },
    OR: [
      { leftAt: null },
      { leftAt: { gt: window.activityStart } },
    ],
  }

  const [
    roster,
    routesRaw,
    visitsRaw,
    workdaysRaw,
    activeWorkdayRaw,
    latestLocationRaw,
    tasksRaw,
    activeTasksRaw,
    planChangesRaw,
  ] = await Promise.all([
    loadFilterAgents(auth.orgId, actor, regionId, teamId),
    prisma.mtmRoute.findMany({
      where: {
        organizationId: auth.orgId,
        date: { gte: window.routeStart, lt: window.routeEnd },
        deletedAt: null,
        publishedVersion: { not: null },
        ...routeScope,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: OPERATIONAL_WEEK_LIMITS.routes + 1,
      select: {
        id: true,
        name: true,
        date: true,
        status: true,
        version: true,
        publishedVersion: true,
        publishedAt: true,
        agentId: true,
        totalPoints: true,
        visitedPoints: true,
        startedAt: true,
        completedAt: true,
        notes: true,
        updatedAt: true,
        assignments: {
          where: broadAssignment,
          orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            agentId: true,
            role: true,
            assignedAt: true,
            removedAt: true,
          },
        },
        points: {
          where: { deletedAt: null },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          take: OPERATIONAL_WEEK_LIMITS.pointsPerRoute + 1,
          select: {
            id: true,
            customerId: true,
            contactId: true,
            orderIndex: true,
            status: true,
            plannedTime: true,
            visitedAt: true,
            notes: true,
            customer: {
              select: {
                id: true,
                name: true,
                objectType: true,
                address: true,
                city: true,
              },
            },
            contact: {
              select: { id: true, displayName: true, type: true, specialtyName: true },
            },
          },
        },
      },
    }),
    prisma.mtmVisit.findMany({
      where: {
        organizationId: auth.orgId,
        deletedAt: null,
        checkInAt: { gte: window.activityStart, lt: window.activityEnd },
        OR: [
          { agentId: selectedAgent.id },
          { participants: { some: participantScope } },
        ],
      },
      orderBy: [{ checkInAt: "asc" }, { id: "asc" }],
      take: OPERATIONAL_WEEK_LIMITS.visits + 1,
      select: {
        id: true,
        agentId: true,
        customerId: true,
        contactId: true,
        routeId: true,
        routePointId: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        outcome: true,
        notes: true,
        resultNotes: true,
        updatedAt: true,
        customer: {
          select: { id: true, name: true, objectType: true, address: true, city: true },
        },
        contact: { select: { id: true, displayName: true, type: true } },
        participants: {
          where: { agentId: selectedAgent.id, role: { not: "OBSERVER" } },
          orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
          select: { id: true, agentId: true, role: true, joinedAt: true, leftAt: true },
        },
      },
    }),
    canReadWorkforce ? prisma.mtmAgentWorkday.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: selectedAgent.id,
        workDate: { gte: window.routeStart, lt: window.routeEnd },
      },
      orderBy: [{ workDate: "asc" }, { id: "asc" }],
      take: requestedDays + 1,
      select: {
        id: true,
        workDate: true,
        status: true,
        startedAt: true,
        pausedAt: true,
        completedAt: true,
        totalPausedSeconds: true,
        updatedAt: true,
        events: {
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          take: OPERATIONAL_WEEK_LIMITS.workdayEventsPerDay + 1,
          select: {
            id: true,
            type: true,
            occurredAt: true,
            accuracy: true,
            note: true,
          },
        },
      },
    }) : Promise.resolve([]),
    canReadWorkforce ? prisma.mtmAgentWorkday.findFirst({
      where: {
        organizationId: auth.orgId,
        agentId: selectedAgent.id,
        status: { in: ["STARTED", "PAUSED"] },
      },
      orderBy: [{ startedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        workDate: true,
        status: true,
        startedAt: true,
        pausedAt: true,
        completedAt: true,
        totalPausedSeconds: true,
        updatedAt: true,
      },
    }) : Promise.resolve(null),
    prisma.mtmAgentLocation.findFirst({
      // GPS status is based on the newest admissible coordinate, never merely
      // the newest raw telemetry row. This is the same quality boundary used
      // by live map/history and prevents a corrupt or very inaccurate sample
      // from replacing older usable evidence and appearing ONLINE.
      where: {
        organizationId: auth.orgId,
        agentId: selectedAgent.id,
        latitude: { gte: -90, lte: 90 },
        longitude: { gte: -180, lte: 180 },
        OR: [
          { accuracy: null },
          { accuracy: { gte: 0, lte: maxAccuracyMeters } },
        ],
      },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        recordedAt: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        battery: true,
      },
    }),
    prisma.mtmTask.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: selectedAgent.id,
        deletedAt: null,
        OR: [
          { dueDate: { gte: window.activityStart, lt: window.activityEnd } },
          { scheduledStartAt: { gte: window.activityStart, lt: window.activityEnd } },
          { completedAt: { gte: window.activityStart, lt: window.activityEnd } },
        ],
      },
      orderBy: [
        { dueDate: "asc" },
        { scheduledStartAt: "asc" },
        { completedAt: "asc" },
        { id: "asc" },
      ],
      take: OPERATIONAL_WEEK_LIMITS.tasks + 1,
      select: operationalTaskSelect,
    }),
    prisma.mtmTask.findMany({
      // The attention rail is a current-work queue, not a period report. Keep
      // its bounded read separate so terminal rows and the selected calendar
      // window cannot mask returned work or an otherwise valid future task.
      where: {
        organizationId: auth.orgId,
        agentId: selectedAgent.id,
        deletedAt: null,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
      orderBy: [
        { dueDate: "asc" },
        { scheduledStartAt: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      take: OPERATIONAL_WEEK_LIMITS.tasks + 1,
      select: operationalTaskSelect,
    }),
    prisma.mtmRouteChangeRequest.findMany({
      where: {
        organizationId: auth.orgId,
        status: { in: [...VISIBLE_PLAN_CHANGE_STATUSES] },
        route: {
          is: {
            organizationId: auth.orgId,
            deletedAt: null,
            publishedVersion: { not: null },
            date: { gte: window.routeStart, lt: window.routeEnd },
            ...routeScope,
          },
        },
      },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      take: OPERATIONAL_WEEK_LIMITS.planChanges + 1,
      select: {
        id: true,
        routeId: true,
        routePointId: true,
        requestedByAgentId: true,
        requestedByAgent: { select: { name: true } },
        changeType: true,
        status: true,
        reason: true,
        payload: true,
        decisionComment: true,
        submittedAt: true,
        reviewedAt: true,
        updatedAt: true,
        route: {
          select: {
            id: true,
            date: true,
            agentId: true,
            publishedVersion: true,
            assignments: {
              where: broadAssignment,
              orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
              select: { id: true, agentId: true, role: true, assignedAt: true, removedAt: true },
            },
          },
        },
        routePoint: {
          select: {
            id: true,
            customer: { select: { id: true, name: true } },
            contact: { select: { id: true, displayName: true } },
          },
        },
      },
    }),
  ])

  // Preserve the fail-closed quality boundary even if legacy data or a mocked
  // database client returns a row that did not satisfy the query predicate.
  const latestLocation = latestLocationRaw &&
    Number.isFinite(latestLocationRaw.latitude) && latestLocationRaw.latitude >= -90 && latestLocationRaw.latitude <= 90 &&
    Number.isFinite(latestLocationRaw.longitude) && latestLocationRaw.longitude >= -180 && latestLocationRaw.longitude <= 180 &&
    (latestLocationRaw.accuracy == null || (
      Number.isFinite(latestLocationRaw.accuracy) && latestLocationRaw.accuracy >= 0 && latestLocationRaw.accuracy <= maxAccuracyMeters
    ))
    ? latestLocationRaw
    : null

  const routesCapped = routesRaw.slice(0, OPERATIONAL_WEEK_LIMITS.routes)
  const routesTruncated = routesRaw.length > OPERATIONAL_WEEK_LIMITS.routes
  const visitsCapped = visitsRaw.slice(0, OPERATIONAL_WEEK_LIMITS.visits)
  const visitsTruncated = visitsRaw.length > OPERATIONAL_WEEK_LIMITS.visits
  const tasks = tasksRaw.slice(0, OPERATIONAL_WEEK_LIMITS.tasks)
  const tasksTruncated = tasksRaw.length > OPERATIONAL_WEEK_LIMITS.tasks
  const activeTaskRows = activeTasksRaw.slice(0, OPERATIONAL_WEEK_LIMITS.tasks)
  const activeTasksTruncated = activeTasksRaw.length > OPERATIONAL_WEEK_LIMITS.tasks
  const planChangesCapped = planChangesRaw.slice(0, OPERATIONAL_WEEK_LIMITS.planChanges)
  const planChangesTruncated = planChangesRaw.length > OPERATIONAL_WEEK_LIMITS.planChanges

  const routes = routesCapped.flatMap((route) => {
    if (route.publishedVersion === null) return []
    const date = routeDateKey(route.date)
    const assignment = route.assignments.find((candidate) =>
      candidate.role !== "OBSERVER" && assignmentIntersectsRouteDay(candidate, date, timezone),
    )
    if (route.agentId !== selectedAgent.id && !assignment) return []
    return [{ ...route, date, assignmentRole: route.agentId === selectedAgent.id ? "PRIMARY" : assignment!.role }]
  })
  const visibleVisits = visitsCapped.filter((visit) =>
    visit.agentId === selectedAgent.id ||
    visit.participants.some((participant) =>
      participant.role !== "OBSERVER" && participantAtVisitTime(participant, visit.checkInAt),
    ),
  ).map((visit) => ({
    ...visit,
    dateKey: dateInputValueInTimezone(visit.checkInAt, timezone),
    attribution: visit.agentId === selectedAgent.id ? "PRIMARY" as const : "PARTICIPANT" as const,
  }))
  const matchingVisits = [...visibleVisits].sort((left, right) => {
    const leftRank = left.status === "CHECKED_OUT" ? 0 : left.status === "CHECKED_IN" ? 1 : 2
    const rightRank = right.status === "CHECKED_OUT" ? 0 : right.status === "CHECKED_IN" ? 1 : 2
    return leftRank - rightRank || left.checkInAt.getTime() - right.checkInAt.getTime() || left.id.localeCompare(right.id)
  })
  const consumedVisitIds = new Set<string>()
  const truncatedSources = new Set<string>()
  if (roster.truncated) truncatedSources.add("FILTER_AGENTS")
  if (routesTruncated) truncatedSources.add("ROUTES")
  if (visitsTruncated) truncatedSources.add("VISITS")
  if (tasksTruncated) truncatedSources.add("TASKS")
  if (activeTasksTruncated) truncatedSources.add("ACTIVE_TASKS")
  if (planChangesTruncated) truncatedSources.add("PLAN_CHANGES")

  let plannedStops = 0
  let actualStops = 0
  let cancelledStops = 0
  let remainingRoutePoints = OPERATIONAL_WEEK_LIMITS.routePointsTotal
  const routesByDay = new Map<string, Array<Record<string, unknown>>>()
  for (const route of routes) {
    const pointLimit = Math.min(OPERATIONAL_WEEK_LIMITS.pointsPerRoute, remainingRoutePoints)
    const pointRows = route.points.slice(0, pointLimit)
    const pointsTruncated = route.points.length > pointLimit
    if (pointsTruncated) truncatedSources.add("ROUTE_POINTS")
    remainingRoutePoints -= pointRows.length
    const points = pointRows.map((point) => {
      const matched = matchOperationalVisit({
        routeId: route.id,
        routeDateKey: route.date,
        pointId: point.id,
        customerId: point.customerId,
        contactId: point.contactId,
      }, matchingVisits.filter((visit) => !consumedVisitIds.has(visit.id)))
      if (matched) consumedVisitIds.add(matched.visit.id)
      const state = operationalPointState({
        routeStatus: route.status,
        pointStatus: point.status,
        visitStatus: matched?.visit.status,
      })
      plannedStops += 1
      if (state === "ACTUAL") actualStops += 1
      if (state === "CANCELLED") cancelledStops += 1
      const actualEvidence = matched
        ? sourceVisit(matched.visit, matched.match)
        : point.status === "VISITED"
          ? { source: "POINT_STATUS" as const, visitedAt: point.visitedAt }
          : null
      const cancellationEvidence = route.status === "CANCELLED"
        ? { source: "PUBLISHED_ROUTE_STATUS" as const, status: route.status, reason: route.notes }
        : point.status === "SKIPPED"
          ? { source: "POINT_STATUS" as const, status: point.status, reason: point.notes }
          : matched?.visit.status === "CANCELLED"
            ? sourceVisit(matched.visit, matched.match)
            : null
      return {
        ...point,
        plannedStatus: point.status,
        executionState: state,
        actualEvidence,
        cancellationEvidence,
      }
    })
    const transformed = {
      id: route.id,
      name: route.name,
      date: route.date,
      status: route.status,
      version: route.version,
      publishedVersion: route.publishedVersion,
      publishedAt: route.publishedAt,
      assignmentRole: route.assignmentRole,
      totalPoints: route.totalPoints,
      visitedPoints: route.visitedPoints,
      startedAt: route.startedAt,
      completedAt: route.completedAt,
      notes: route.notes,
      pointsTruncated,
      points,
    }
    routesByDay.set(route.date, [...(routesByDay.get(route.date) ?? []), transformed])
  }

  const unplannedVisitsAll = visibleVisits.filter((visit) => !consumedVisitIds.has(visit.id))
  const unplannedVisits = unplannedVisitsAll.slice(0, OPERATIONAL_WEEK_LIMITS.unplannedVisits)
  if (unplannedVisitsAll.length > OPERATIONAL_WEEK_LIMITS.unplannedVisits) {
    truncatedSources.add("UNPLANNED_VISITS")
  }
  const workdays = workdaysRaw.slice(0, requestedDays)
  if (workdaysRaw.length > requestedDays) truncatedSources.add("WORKDAYS")
  const workdayByDay = new Map(workdays.map((workday) => [routeDateKey(workday.workDate), workday]))
  const activeWorkdayDate = activeWorkdayRaw ? routeDateKey(activeWorkdayRaw.workDate) : null
  for (const workday of workdays) {
    if (workday.events.length > OPERATIONAL_WEEK_LIMITS.workdayEventsPerDay) {
      truncatedSources.add("WORKDAY_EVENTS")
    }
  }
  const canMutateWorkday = canReadWorkforce && actor.role === "AGENT" && actor.agentId === selectedAgent.id
  const days = Array.from({ length: requestedDays }, (_, index) => {
    const date = new Date(window.routeStart)
    date.setUTCDate(date.getUTCDate() + index)
    const dateKey = routeDateKey(date)
    const dayRoutes = routesByDay.get(dateKey) ?? []
    const dayVisits = visibleVisits.filter((visit) => visit.dateKey === dateKey)
    const dayUnplannedVisits = unplannedVisits.filter((visit) => visit.dateKey === dateKey)
    const dayTasks = tasks.filter((task) => {
      const due = task.dueDate ? dateInputValueInTimezone(task.dueDate, timezone) : null
      const scheduledStart = task.scheduledStartAt
        ? dateInputValueInTimezone(task.scheduledStartAt, timezone)
        : null
      const completed = task.completedAt ? dateInputValueInTimezone(task.completedAt, timezone) : null
      const completedInWindow = completed !== null && completed >= window.start && completed < window.endExclusive
      const dueInWindow = due !== null && due >= window.start && due < window.endExclusive
      const scheduledStartInWindow = scheduledStart !== null
        && scheduledStart >= window.start
        && scheduledStart < window.endExclusive
      const displayDate = completedInWindow
        ? completed
        : dueInWindow
          ? due
          : scheduledStartInWindow
            ? scheduledStart
            : null
      return displayDate === dateKey
    })
    const workday = workdayByDay.get(dateKey)
    const durationAnomalous = Boolean(
      workday &&
      workday.id === activeWorkdayRaw?.id &&
      dateKey !== today,
    )
    const dayPoints = dayRoutes.flatMap((route) => (route.points as Array<{ executionState: string }>))
    return {
      date: dateKey,
      isToday: dateKey === today,
      summary: {
        routes: dayRoutes.length,
        plannedStops: dayPoints.length,
        actualStops: dayPoints.filter((point) => point.executionState === "ACTUAL").length,
        cancelledStops: dayPoints.filter((point) => point.executionState === "CANCELLED").length,
        visits: dayVisits.length,
        unplannedVisits: dayUnplannedVisits.length,
        tasks: dayTasks.length,
        tasksCompleted: dayTasks.filter((task) => task.status === "COMPLETED").length,
      },
      workday: workday ? {
        id: workday.id,
        state: mapWorkdayState(workday.status),
        status: workday.status,
        startedAt: workday.startedAt,
        pausedAt: workday.pausedAt,
        completedAt: workday.completedAt,
        totalPausedSeconds: workday.totalPausedSeconds,
        // A shift left active across tenant-local midnight needs explicit
        // correction. Do not present overnight wall-clock time as worked time.
        workedSeconds: durationAnomalous ? null : workedSeconds(workday, generatedAt),
        durationAnomalous,
        durationReason: durationAnomalous ? "ACTIVE_FROM_PRIOR_DAY" : null,
        events: workday.events.slice(0, OPERATIONAL_WEEK_LIMITS.workdayEventsPerDay),
        availableActions: canMutateWorkday && (dateKey === today || workday.id === activeWorkdayRaw?.id)
          ? availableWorkdayActions(workday.status)
          : [],
      } : {
        id: null,
        state: "NOT_STARTED",
        status: null,
        startedAt: null,
        pausedAt: null,
        completedAt: null,
        totalPausedSeconds: 0,
        workedSeconds: 0,
        durationAnomalous: false,
        durationReason: null,
        events: [],
        availableActions: canMutateWorkday && dateKey === today && !activeWorkdayRaw ? ["START"] : [],
      },
      routes: dayRoutes,
      unplannedVisits: dayUnplannedVisits.map(publicVisit),
      tasks: dayTasks,
    }
  })

  const planChanges = planChangesCapped.flatMap((change) => {
    if (change.route.publishedVersion === null) return []
    const date = routeDateKey(change.route.date)
    const assignment = change.route.assignments.find((candidate) =>
      candidate.role !== "OBSERVER" && assignmentIntersectsRouteDay(candidate, date, timezone),
    )
    if (change.route.agentId !== selectedAgent.id && !assignment) return []
    const changePayload = change.payload && typeof change.payload === "object" && !Array.isArray(change.payload)
      ? change.payload
      : null
    return [{
      id: change.id,
      routeId: change.routeId,
      routePointId: change.routePointId,
      routeDate: date,
      publishedVersion: change.route.publishedVersion,
      requestedBySelectedAgent: change.requestedByAgentId === selectedAgent.id,
      requestedByName: change.requestedByAgent?.name ?? null,
      canReview: canReviewMtmRouteRequest(actor, change.requestedByAgentId),
      changeType: change.changeType,
      status: change.status,
      reason: change.reason,
      reasonCode: changePayload && typeof changePayload.reasonCode === "string"
        ? changePayload.reasonCode
        : null,
      resolution: changePayload && typeof changePayload.resolution === "string" ? changePayload.resolution : null,
      rescheduleDate: changePayload && typeof changePayload.rescheduleDate === "string" ? changePayload.rescheduleDate : null,
      rescheduledRouteId: changePayload && typeof changePayload.rescheduledRouteId === "string" ? changePayload.rescheduledRouteId : null,
      impact: change.changeType === "REMOVE_STOP"
        ? { plannedStops: -1, eligibleStops: -1, actualStops: 0 }
        : change.changeType === "ADD_STOP"
          ? { plannedStops: 1, eligibleStops: 1, actualStops: 0 }
          : { plannedStops: 0, eligibleStops: 0, actualStops: 0 },
      decisionComment: change.decisionComment,
      submittedAt: change.submittedAt,
      reviewedAt: change.reviewedAt,
      updatedAt: change.updatedAt,
      customer: change.routePoint?.customer ?? null,
      contact: change.routePoint?.contact ?? null,
    }]
  })
  const pendingPlanChanges = planChanges.filter((change) =>
    (PENDING_PLAN_CHANGE_STATUSES as readonly string[]).includes(change.status),
  )
  const activeTasks = buildOperationalTaskQueue(activeTaskRows, generatedAt)
  const eligibleStops = Math.max(0, plannedStops - cancelledStops)
  const coverage = {
    plannedStops,
    eligibleStops,
    actualStops,
    cancelledStops,
    openStops: Math.max(0, eligibleStops - actualStops),
    // No eligible denominator is not a 0% execution failure. Keep it
    // explicitly unavailable so every consumer can render N/A truthfully.
    percentage: eligibleStops === 0 ? null : Math.round((actualStops / eligibleStops) * 1_000) / 10,
  }
  const gps = latestLocation ? {
    freshness: classifyGpsFreshness(latestLocation.recordedAt, generatedAt, {
      onlineSeconds: settings.offlineThresholdSeconds,
      delayedSeconds: Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60),
    }),
    recordedAt: latestLocation.recordedAt,
    latitude: latestLocation.latitude,
    longitude: latestLocation.longitude,
    accuracy: latestLocation.accuracy,
    battery: latestLocation.battery,
    reason: null,
    thresholds: {
      onlineSeconds: settings.offlineThresholdSeconds,
      delayedSeconds: Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60),
    },
  } : {
    freshness: "NO_LOCATION" as const,
    recordedAt: null,
    latitude: null,
    longitude: null,
    accuracy: null,
    battery: null,
    reason: explainMissingLocation({ hasLocation: false, lastSeenAt: selectedAgent.lastSeenAt }),
    thresholds: {
      onlineSeconds: settings.offlineThresholdSeconds,
      delayedSeconds: Math.max(settings.offlineThresholdSeconds, settings.locationWindowMinutes * 60),
    },
  }
  const sourceDates = [
    ...routes.map((route) => route.updatedAt),
    ...visibleVisits.map((visit) => visit.updatedAt),
    ...workdays.map((workday) => workday.updatedAt),
    activeWorkdayRaw?.updatedAt,
    ...workdays.flatMap((workday) => workday.events.map((event) => event.occurredAt)),
    ...tasks.map((task) => task.updatedAt),
    ...activeTaskRows.map((task) => task.updatedAt),
    ...planChanges.map((change) => change.updatedAt),
    latestLocation?.recordedAt,
  ]
  const lastSourceAt = latestOperationalSourceAt(sourceDates)
  const filters = filtersFromAgents(includeSelectedFilterAgent(roster.rows, selectedAgent), {
    regionId,
    teamId,
    agentId: selectedAgent.id,
  }, roster.truncated)
  const completeness = {
    authoritative: truncatedSources.size === 0,
    truncatedSources: [...truncatedSources].sort(),
    limits: {
      ...OPERATIONAL_WEEK_LIMITS,
      activeTasks: OPERATIONAL_WEEK_LIMITS.tasks,
    },
    returned: {
      filterAgents: roster.rows.length,
      routes: routes.length,
      routePoints: plannedStops,
      visits: visibleVisits.length,
      unplannedVisits: unplannedVisits.length,
      workdays: workdays.length,
      tasks: tasks.length,
      activeTasks: activeTasks.length,
      planChanges: planChanges.length,
    },
  }
  const selectedAgentData = {
    id: selectedAgent.id,
    name: selectedAgent.name,
    role: selectedAgent.role,
    team: selectedAgent.team ? { id: selectedAgent.team.id, name: selectedAgent.team.name } : null,
    region: selectedAgent.team?.region ?? null,
  }
  const activeWorkdayIsPriorDay = Boolean(activeWorkdayDate && activeWorkdayDate !== today)
  const activeWorkdayData = activeWorkdayRaw && activeWorkdayDate ? {
    id: activeWorkdayRaw.id,
    date: activeWorkdayDate,
    state: mapWorkdayState(activeWorkdayRaw.status),
    status: activeWorkdayRaw.status,
    startedAt: activeWorkdayRaw.startedAt,
    pausedAt: activeWorkdayRaw.pausedAt,
    completedAt: activeWorkdayRaw.completedAt,
    totalPausedSeconds: activeWorkdayRaw.totalPausedSeconds,
    workedSeconds: activeWorkdayIsPriorDay ? null : workedSeconds(activeWorkdayRaw, generatedAt),
    durationAnomalous: activeWorkdayIsPriorDay,
    durationReason: activeWorkdayIsPriorDay ? "ACTIVE_FROM_PRIOR_DAY" : null,
    requiresPriorDayClosure: activeWorkdayIsPriorDay,
    outsideSelectedWindow: activeWorkdayDate < window.start || activeWorkdayDate >= window.endExclusive,
  } : null
  const snapshotSource = {
    protocolVersion: 1,
    period: {
      anchor: window.anchor,
      start: window.start,
      endExclusive: window.endExclusive,
      days: window.days,
      timezone,
    },
    scope: {
      role: actor.role,
      selectedEmployeeOnly: true,
    },
    selectedAgent: selectedAgentData,
    days,
    queues: { planChanges, pendingPlanChanges, activeTasks },
    coverage,
    gps,
    workdayContext: { activeWorkday: activeWorkdayData },
    completeness,
  }
  // Source identity deliberately excludes projections that advance with the
  // clock (`workedSeconds`, `isToday`, available actions and GPS freshness).
  // The cached payload can be refreshed in place while its source snapshot
  // remains stable until a business/telemetry fact actually changes.
  const stableDays = days.map(({ isToday: _isToday, ...day }) => {
    const {
      workedSeconds: _workedSeconds,
      durationAnomalous: _durationAnomalous,
      durationReason: _durationReason,
      availableActions: _availableActions,
      ...workday
    } = day.workday
    return { ...day, workday }
  })
  const { freshness: _gpsFreshness, ...stableGps } = gps
  const stableActiveWorkday = activeWorkdayData ? {
    id: activeWorkdayData.id,
    date: activeWorkdayData.date,
    state: activeWorkdayData.state,
    status: activeWorkdayData.status,
    startedAt: activeWorkdayData.startedAt,
    pausedAt: activeWorkdayData.pausedAt,
    completedAt: activeWorkdayData.completedAt,
    totalPausedSeconds: activeWorkdayData.totalPausedSeconds,
    outsideSelectedWindow: activeWorkdayData.outsideSelectedWindow,
  } : null
  const snapshotId = operationalWeekSnapshotId({
    protocolVersion: snapshotSource.protocolVersion,
    period: snapshotSource.period,
    scope: snapshotSource.scope,
    selectedAgent: snapshotSource.selectedAgent,
    days: stableDays,
    queues: {
      ...snapshotSource.queues,
      // Attention changes when the response clock crosses a due-date boundary;
      // neither it nor its attention-driven display order may mutate the
      // identity of an otherwise unchanged source snapshot.
      activeTasks: snapshotSource.queues.activeTasks
        .map(({ attention: _attention, ...task }) => task)
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    },
    coverage: snapshotSource.coverage,
    gps: stableGps,
    workdayContext: { activeWorkday: stableActiveWorkday },
    completeness: snapshotSource.completeness,
  })
  const todayInWindow = today >= window.start && today < window.endExclusive
  const todayWorkday = todayInWindow ? workdayByDay.get(today) : undefined
  const actionWorkday = activeWorkdayRaw ?? todayWorkday
  const actionDate = activeWorkdayDate ?? today

  // Reading latest telemetry is privacy-sensitive. Audit best-effort and do
  // not store coordinates, accuracy, or battery in the audit payload.
  if (latestLocation) {
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: selectedAgent.id,
      action: "WEEK_GPS_LATEST_READ",
      entity: "agent",
      entityId: selectedAgent.id,
      metadataKind: "gps_latest_access",
      newData: {
        selectedAgentId: selectedAgent.id,
        periodStart: window.start,
        periodEndExclusive: window.endExclusive,
        days: window.days,
        source: "LATEST_RECORDED_COORDINATE",
      },
      req,
    }).catch((error) => console.warn("[MTM/week] GPS access audit failed", error))
  }

  return NextResponse.json({
    success: true,
    data: {
      mode: "WEEK",
      ...snapshotSource,
      filters,
      today,
      capabilities: {
        workday: {
          enabled: canReadWorkforce,
          canMutateSelf: canMutateWorkday,
          endpoint: "/api/v1/mtm/week/workday",
          date: actionDate,
          workdayId: actionWorkday?.id ?? null,
          requiresPriorDayClosure: Boolean(activeWorkdayData?.requiresPriorDayClosure),
          availableActions: canMutateWorkday && (Boolean(activeWorkdayRaw) || todayInWindow)
            ? availableWorkdayActions(actionWorkday?.status ?? null)
            : [],
        },
        managerReadOnly: actor.role !== "AGENT",
      },
      contract: {
        authorizationScope: "CURRENT_ACTIVE_TENANT_TEAM_MANAGER_SCOPE",
        planSource: "PUBLISHED_ROUTE_VERSION",
        cancelledPublishedRoutesRetained: true,
        routeAssignment: "NON_OBSERVER_AT_TENANT_LOCAL_ROUTE_DAY",
        visitAttribution: "PRIMARY_OR_NON_OBSERVER_PARTICIPANT_AT_CHECK_IN",
        actualMatching: ["ROUTE_POINT", "ROUTE_SUBJECT", "DAY_SUBJECT"],
        actualVisitConsumption: "ONE_TO_ONE",
        planChangeName: "PLAN_CHANGES",
        gpsIndependentFromWorkday: true,
        transactionConsistency: "READ_COMMITTED_BEST_EFFORT",
      },
      generatedAt,
      lastSourceAt,
      snapshotId,
      offline: { snapshotId, capturedAt: generatedAt, lastSourceAt },
    },
  })
})
