import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hasMtmCoordinates, withNormalizedCoordinates } from "@/lib/mtm/geo-coordinates"
import { effectiveGeofenceRadius } from "@/lib/mtm/visit-place-check"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { calculateDistance } from "@/lib/geo-utils"
import { RouteUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import {
  acquireMtmRouteScheduleLocks,
  buildMtmRouteDedupeKey,
  detectMtmRouteInternalScheduleConflicts,
  detectMtmRoutePlanningSignals,
  normalizeMtmRouteAssignments,
  type MtmRouteConflict,
  type MtmRoutePlanningSignals,
} from "@/lib/mtm/route-planning"
import {
  appendMtmRouteChangeEvidenceOutcome,
  attachMtmRouteChangeEvidence,
  createMtmRouteChangeEvidence,
} from "@/lib/mtm/route-change-evidence"
import {
  applyPublishedRoutePointDiff,
  diffPublishedRoutePoints,
  isRetryableRouteTransactionConflict,
  lockPublishedRoutePoints,
  PublishedRoutePointsChangedError,
  publishedRouteAuditStops,
  publishedRoutePointDiffSelect,
  publishedRouteResultPoints,
  samePublishedRoutePointDiff,
  toPublishedRouteExistingPoint,
  type PublishedRoutePointDiff,
} from "@/lib/mtm/route-published-diff"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"
import {
  canAssignMtmRouteAgents,
  canEditMtmRoute,
  canEditMtmRouteDraft,
  canViewMtmRoute,
  isAgentInRouteScope,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  validateMtmMobileRouteTargetEligibility,
  validateMtmRouteTargets,
} from "@/lib/mtm/route-targets"
import { GOOGLE_ROUTES_PROVIDER_KEY, resolveGoogleRoutesRuntimeConfig } from "@/lib/mtm/google-routes"
import { mtmRouteExactScopeWhere } from "@/lib/mtm/route-access"
import { createMtmRouteTravelPlan, resolveMtmRouteTravelPolicy } from "@/lib/mtm/route-travel"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { assignmentIntersectsRouteDay } from "@/lib/mtm/operational-week"
import { isValidTimezone } from "@/lib/timezone"

const routeInclude = {
  agent: { select: { id: true, name: true } },
  assignments: {
    where: { removedAt: null },
    include: { agent: { select: { id: true, name: true, role: true } } },
    orderBy: { assignedAt: "asc" as const },
  },
  changeRequests: {
    where: { status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] as Array<"SUBMITTED" | "IN_REVIEW" | "NEEDS_INFO"> } },
    select: { id: true, changeType: true, status: true, routePointId: true },
    orderBy: { submittedAt: "desc" as const },
  },
  points: {
    where: { deletedAt: null },
    include: {
      changeRequests: {
        where: { status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] as Array<"SUBMITTED" | "IN_REVIEW" | "NEEDS_INFO"> } },
        select: { id: true, changeType: true, status: true },
      },
      customer: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          phone: true,
          latitude: true,
          longitude: true,
          geofenceRadius: true,
        },
      },
      contact: {
        select: { id: true, displayName: true, type: true, specialtyName: true, phone: true },
      },
    },
    orderBy: { orderIndex: "asc" as const },
  },
}

const routeDetailInclude = {
  ...routeInclude,
  // Exact drilldowns need historical assignment intervals for authorization.
  // Removed assignments are stripped again before the route is serialized.
  assignments: {
    include: { agent: { select: { id: true, name: true, role: true } } },
    orderBy: { assignedAt: "asc" as const },
  },
  points: {
    ...routeInclude.points,
    include: {
      ...routeInclude.points.include,
      // Plan versus fact per stop (prod audit 2026-09-14): the dialog showed
      // one time and nothing about lateness, order, zone or evidence. Reduced
      // to a serializable fact in GET below — note text and the signature
      // drawing never leave the server, only whether they exist.
      visits: {
        where: { deletedAt: null },
        orderBy: { checkInAt: "asc" as const },
        select: {
          id: true,
          agentId: true,
          status: true,
          checkInAt: true,
          checkOutAt: true,
          checkInLat: true,
          checkInLng: true,
          checkOutLat: true,
          checkOutLng: true,
          notes: true,
          resultNotes: true,
          _count: { select: { photos: true } },
          actionResults: {
            where: { actionKey: "SIGNATURE" as const, status: "COMPLETED" as const },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  },
}

type RoutePointVisitRow = {
  id: string
  agentId: string
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  checkInLat: number | null
  checkInLng: number | null
  checkOutLat: number | null
  checkOutLng: number | null
  notes: string | null
  resultNotes: string | null
  _count?: { photos: number }
  actionResults?: Array<{ id: string }>
}

type RouteAssignmentRow = {
  agentId: string
  role: "PRIMARY" | "PARTICIPANT" | "OBSERVER"
}

type HistoricalRouteAssignmentRow = RouteAssignmentRow & {
  assignedAt: Date
  removedAt: Date | null
}

type RoutePointRow = {
  id: string
  customerId: string
  contactId: string | null
  orderIndex: number
  plannedTime: Date | null
  status: "PENDING" | "VISITED" | "SKIPPED"
  customer: {
    latitude: number | null
    longitude: number | null
    geofenceRadius?: number | null
  }
  visits?: RoutePointVisitRow[]
}

class RouteVersionConflict extends Error {}

/**
 * Sorted, de-duplicated agent ids of a route's crew. Built with explicit
 * string guards: the Prisma row type reaches this handler loosely enough that
 * a Set spread over it was inferred as unknown[] (TS2322 in CI).
 */
function routeCrewAgentIds(
  primaryAgentId: string,
  assignments: ReadonlyArray<{ agentId: unknown; role: unknown }>,
  options: { includeObservers: boolean },
): string[] {
  const ids = new Set<string>([primaryAgentId])
  for (const assignment of assignments) {
    if (typeof assignment.agentId !== "string") continue
    if (!options.includeObservers && assignment.role === "OBSERVER") continue
    ids.add(assignment.agentId)
  }
  return [...ids].sort()
}

class RouteScheduleConflict extends Error {
  constructor(readonly conflicts: MtmRouteConflict[]) {
    super("Route conflicts require manager approval")
  }
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function routeNotFound() {
  return NextResponse.json({ error: "Not found", code: "MTM_ROUTE_NOT_FOUND" }, { status: 404 })
}

function mobileTargetAssignmentRequired() {
  return NextResponse.json({
    error: "Route target is unavailable for this employee on this date",
    code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED",
  }, { status: 403 })
}

function routeTargetPairKey(point: { customerId: string; contactId?: string | null }): string {
  return JSON.stringify([point.customerId, point.contactId ?? null])
}

async function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await actorFor(auth)
  if (!actor) return forbidden()

  const { searchParams } = new URL(req.url)
  const agentLat = searchParams.get("latitude") ? parseFloat(searchParams.get("latitude")!) : null
  const agentLng = searchParams.get("longitude") ? parseFloat(searchParams.get("longitude")!) : null

  try {
    const route = await prisma.mtmRoute.findFirst({
      where: mtmRouteExactScopeWhere(actor, auth.orgId, id),
      include: routeDetailInclude,
    })
    if (!route) return routeNotFound()

    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const routeDate = route.date.toISOString().slice(0, 10)
    const activeAssignments = route.assignments.filter(
      (assignment: HistoricalRouteAssignmentRow) => assignment.removedAt === null,
    )
    const historicalAssignedAgentIds = route.publishedVersion !== null
      ? route.assignments
          .filter((assignment: HistoricalRouteAssignmentRow) =>
            assignment.role !== "OBSERVER" &&
            assignmentIntersectsRouteDay(assignment, routeDate, timezone),
          )
          .map((assignment: HistoricalRouteAssignmentRow) => assignment.agentId)
      : []
    const assignedAgentIds = [...new Set([
      ...activeAssignments
        .filter((assignment: HistoricalRouteAssignmentRow) => assignment.role !== "OBSERVER")
        .map((assignment: HistoricalRouteAssignmentRow) => assignment.agentId),
      ...historicalAssignedAgentIds,
    ])]

    if (!canViewMtmRoute(actor, {
      primaryAgentId: route.agentId,
      assignedAgentIds,
      status: route.status,
    })) return routeNotFound()

    const points = route.points.map((point: RoutePointRow) => {
      const customer = withNormalizedCoordinates(point.customer)
      const distanceMeters =
        agentLat != null && agentLng != null && hasMtmCoordinates(customer)
          ? Math.round(calculateDistance(agentLat, agentLng, customer.latitude, customer.longitude))
          : null
      // Check-in coordinates are an employee's location. A co-participant
      // outside the reader's current scope keeps the times of their visit on
      // this route, but not where they stood.
      const visits = (point.visits ?? []).map((visit) => {
        const locationVisible = isAgentInRouteScope(actor, visit.agentId)
        return {
          id: visit.id,
          status: visit.status,
          checkInAt: visit.checkInAt,
          checkOutAt: visit.checkOutAt,
          checkInLat: locationVisible ? visit.checkInLat : null,
          checkInLng: locationVisible ? visit.checkInLng : null,
          checkOutLat: locationVisible ? visit.checkOutLat : null,
          checkOutLng: locationVisible ? visit.checkOutLng : null,
          // Says the blanks above are redaction, not a visit without GPS.
          locationHidden: !locationVisible,
          photoCount: visit._count?.photos ?? 0,
          hasSignature: (visit.actionResults?.length ?? 0) > 0,
          hasNote: Boolean(visit.notes?.trim() || visit.resultNotes?.trim()),
        }
      })
      const geofenceRadiusMeters = effectiveGeofenceRadius(customer.geofenceRadius, settings.geofenceRadius)
      return { ...point, customer, distanceMeters, visits, geofenceRadiusMeters }
    })
    const travelPolicy = resolveMtmRouteTravelPolicy({
      tenantCalculationEnabled: settings.routeTravelEnabled,
      tenantNavigationEnabled: settings.routeTravelNavigationEnabled,
      providerKey: resolveGoogleRoutesRuntimeConfig(auth.orgId) ? GOOGLE_ROUTES_PROVIDER_KEY : null,
    })
    const travelPlan = createMtmRouteTravelPlan({
      routeId: route.id,
      routeVersion: route.version,
      points: points.map((point) => ({
        id: point.id,
        orderIndex: point.orderIndex,
        latitude: point.customer.latitude,
        longitude: point.customer.longitude,
      })),
      policy: travelPolicy,
    })

    // Historical participation authorizes this route, not the identities of
    // employees outside the caller's current team/manager scope.
    const primaryAgentVisible = isAgentInRouteScope(actor, route.agentId)
    const publicAssignments = activeAssignments.filter(
      (assignment: HistoricalRouteAssignmentRow) =>
        assignment.role !== "OBSERVER" && isAgentInRouteScope(actor, assignment.agentId),
    )
    const hasCurrentAccess = canViewMtmRoute(actor, {
      primaryAgentId: route.agentId,
      assignedAgentIds: activeAssignments
        .filter((assignment: HistoricalRouteAssignmentRow) => assignment.role !== "OBSERVER")
        .map((assignment: HistoricalRouteAssignmentRow) => assignment.agentId),
      status: route.status,
    })

    return NextResponse.json({
      success: true,
      data: {
        ...route,
        agentId: primaryAgentVisible ? route.agentId : null,
        agent: primaryAgentVisible ? route.agent : null,
        assignments: publicAssignments,
        primaryAgentHidden: !primaryAgentVisible,
        hiddenAssignmentCount: activeAssignments.length - publicAssignments.length,
        historicalAccessOnly: !hasCurrentAccess,
        points,
        travelPlan,
        travelPolicy,
      },
    })
  } catch (error) {
    console.error("[MTM/routes/[id] GET]", error)
    return NextResponse.json({ error: "Failed to fetch route" }, { status: 500 })
  }
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await actorFor(auth)
  if (!actor) return forbidden()

  try {
    const raw = await req.json()
    const parsed = parseBody(RouteUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const settings = await getMtmSettings(auth.orgId)
    if (!settings.routeAssignmentsEnabled && (body.assignments?.length ?? 0) > 1) {
      return NextResponse.json({ error: "Multi-agent route assignments are disabled", code: "MTM_ROUTE_ASSIGNMENTS_DISABLED" }, { status: 409 })
    }

    const before = await prisma.mtmRoute.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null },
      include: {
        assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
        points: {
          where: { deletedAt: null },
          select: publishedRoutePointDiffSelect,
          orderBy: { orderIndex: "asc" },
        },
      },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const assignedAgentIds = before.assignments.map((assignment: RouteAssignmentRow) => assignment.agentId)
    if (!canViewMtmRoute(actor, {
      primaryAgentId: before.agentId,
      assignedAgentIds,
      status: before.status,
    })) return forbidden()

    if (body.expectedVersion !== before.version) {
      return NextResponse.json({
        error: "This route was changed by another user. Reload it before saving.",
        code: "ROUTE_VERSION_CONFLICT",
        currentVersion: before.version,
        updatedAt: before.updatedAt,
      }, { status: 409 })
    }
    const isPublishedEdit = before.status !== "DRAFT"
    // Published and started routes: managers, supervisors and admins in scope
    // change stops directly (owner decision 2026-09-15). Everyone else —
    // field agents included, whose Route Field app uses UPDATE_PUBLISHED —
    // keeps the historical answer, and finished routes stay immutable.
    if (isPublishedEdit && !canEditMtmRoute(actor, {
      primaryAgentId: before.agentId,
      assignedAgentIds,
      status: before.status,
    })) {
      return NextResponse.json({
        error: "Published routes are immutable. Submit a route change request.",
        code: "ROUTE_PUBLISHED_IMMUTABLE",
        currentVersion: before.version,
      }, { status: 409 })
    }
    if (!isPublishedEdit && !canEditMtmRouteDraft(actor, {
      primaryAgentId: before.agentId,
      assignedAgentIds,
      status: before.status,
    })) {
      return NextResponse.json({
        error: "This route can no longer be edited",
        code: "ROUTE_NOT_EDITABLE",
      }, { status: 409 })
    }
    if (isPublishedEdit && body.status !== undefined && body.status !== before.status) {
      return NextResponse.json({
        error: "A published route changes status only through its own transitions",
        code: "ROUTE_TRANSITION_INVALID",
      }, { status: 409 })
    }
    if (body.status && body.status !== "DRAFT" && body.status !== "CANCELLED" && !isPublishedEdit) {
      return NextResponse.json({
        error: body.status === "PLANNED" ? "Use the publish endpoint" : "Invalid manual route transition",
        code: body.status === "PLANNED" ? "USE_PUBLISH_ENDPOINT" : "ROUTE_TRANSITION_INVALID",
      }, { status: 409 })
    }

    let assignmentInput = before.assignments.map((assignment: RouteAssignmentRow) => ({
      agentId: assignment.agentId,
      role: assignment.role,
    }))
    if (body.assignments) {
      assignmentInput = body.assignments
    } else if (body.agentId && body.agentId !== before.agentId) {
      assignmentInput = [
        { agentId: body.agentId, role: "PRIMARY" },
        ...assignmentInput.filter((assignment: RouteAssignmentRow) => assignment.role !== "PRIMARY"),
      ]
    }
    const normalized = normalizeMtmRouteAssignments(
      body.assignments ? body.agentId : undefined,
      assignmentInput,
    )
    const participantIds = normalized.assignments
      .filter((assignment) => assignment.role !== "PRIMARY")
      .map((assignment) => assignment.agentId)
    if (!canAssignMtmRouteAgents(actor, normalized.primaryAgentId, participantIds)) return forbidden()

    let pointInput: Array<{ customerId: string; contactId?: string | null; plannedTime?: string | Date | null }> =
      body.points ?? before.points.map((point: Pick<RoutePointRow, "customerId" | "contactId" | "plannedTime">) => ({
        customerId: point.customerId,
        contactId: point.contactId,
        plannedTime: point.plannedTime,
      }))
    const agentIds = [...new Set(normalized.assignments.map((assignment) => assignment.agentId))]
    const routeDate = body.date ? new Date(body.date) : before.date
    const primaryAgentChanged = normalized.primaryAgentId !== before.agentId
    const routeDateChanged = routeDate.getTime() !== before.date.getTime()
    let publishedDiff: Extract<PublishedRoutePointDiff, { ok: true }> | null = null
    if (isPublishedEdit) {
      // The route builder resends the whole form. The date, the employee and
      // the crew of a published route are what the field already acts on;
      // moving them is a new route, not an edit.
      // Working crew only (PRIMARY + PARTICIPANT): the builder never loads or
      // sends OBSERVER rows, and assignments are not rewritten on this path.
      const assignmentSignature = (items: ReadonlyArray<{ agentId: string; role: string }>) =>
        [...new Set(items.filter((item) => item.role !== "OBSERVER").map((item) => item.agentId))].sort().join(",")
      if (
        primaryAgentChanged
        || routeDateChanged
        || assignmentSignature(normalized.assignments) !== assignmentSignature(before.assignments)
      ) {
        return NextResponse.json({
          error: "The date and employees of a published route cannot be changed",
          code: "ROUTE_PUBLISHED_FIELDS_LOCKED",
        }, { status: 409 })
      }
      if (body.points !== undefined) {
        if (body.points.length === 0) {
          return NextResponse.json({ error: "A route must contain at least one stop", code: "ROUTE_EMPTY" }, { status: 409 })
        }
        const diff = diffPublishedRoutePoints(before.points.map(toPublishedRouteExistingPoint), body.points)
        if (!diff.ok) {
          return NextResponse.json(diff.code === "ROUTE_VISITED_POINTS_LOCKED"
            ? {
                error: "Visited or skipped stops cannot be removed, reordered or retimed",
                code: diff.code,
                pointIds: diff.pointIds,
              }
            : {
                error: "A stop with a pending change request cannot be removed",
                code: diff.code,
                pointIds: diff.pointIds,
              }, { status: 409 })
        }
        publishedDiff = diff
        pointInput = publishedRouteResultPoints(body.points, diff)
        if (detectMtmRouteInternalScheduleConflicts(pointInput).length > 0) {
          return NextResponse.json({
            error: "Two route stops cannot use the same meeting time",
            code: "ROUTE_POINT_TIME_CONFLICT",
          }, { status: 409 })
        }
      }
    }
    const existingTargetPairs = new Set(before.points.map(routeTargetPairKey))
    const mobileEligibilityPoints = auth.principal !== "mobile"
      ? []
      : primaryAgentChanged || routeDateChanged
        ? pointInput
        : body.points !== undefined
          ? pointInput.filter((point) => !existingTargetPairs.has(routeTargetPairKey(point)))
          : []
    const [agents, targetValidation, mobileTargetEligibility] = await Promise.all([
      prisma.mtmAgent.findMany({
        where: { organizationId: auth.orgId, id: { in: agentIds }, status: "ACTIVE" },
        select: { id: true, teamId: true },
      }),
      validateMtmRouteTargets(prisma, {
        organizationId: auth.orgId,
        routeDate,
        // Stops with field history are not re-validated (same as Route Field):
        // a customer deactivated after the visit must not freeze the day.
        points: publishedDiff
          ? pointInput.filter((_, index) => !publishedDiff?.kept.some((point) => point.orderIndex === index && point.locked))
          : pointInput,
      }),
      auth.principal === "mobile"
        ? validateMtmMobileRouteTargetEligibility(prisma, {
            organizationId: auth.orgId,
            primaryAgentId: normalized.primaryAgentId,
            routeDate,
            points: mobileEligibilityPoints,
          })
        : Promise.resolve({ ok: true }),
    ])
    const foundAgents = new Set(agents.map((agent: { id: string }) => agent.id))
    const missingAgentIds = agentIds.filter((agentId) => !foundAgents.has(agentId))
    if (missingAgentIds.length > 0 || !targetValidation.ok) {
      return NextResponse.json({
        error: "Route references are outside the organization or inactive",
        code: "MTM_ROUTE_REFERENCE_INVALID",
        details: { missingAgentIds, ...targetValidation },
      }, { status: 400 })
    }
    if (!mobileTargetEligibility.ok) return mobileTargetAssignmentRequired()

    if (settings.enforceWorkCalendarForRoutes) {
      const primaryAgent = agents.find((agent: { id: string }) => agent.id === normalized.primaryAgentId)
      const date = routeDate.toISOString().slice(0, 10)
      const calendarOverrides = await prisma.mtmWorkCalendarDay.findMany({
        where: {
          organizationId: auth.orgId,
          date: routeDate,
          deletedAt: null,
          OR: [
            { teamId: null, agentId: null },
            ...(primaryAgent?.teamId ? [{ teamId: primaryAgent.teamId, agentId: null }] : []),
            { teamId: null, agentId: normalized.primaryAgentId },
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
      })
      const calendarDay = resolveWorkCalendarDay({
        date,
        overrides: calendarOverrides as WorkCalendarOverride[],
        teamId: primaryAgent?.teamId ?? null,
        agentId: normalized.primaryAgentId,
      })
      if (!calendarDay.routePlanningAllowed) {
        return NextResponse.json({
          error: "Route planning is not allowed on this calendar day",
          code: "MTM_ROUTE_NON_WORKING_DAY",
          calendarDay,
        }, { status: 409 })
      }
    }
    const dedupeKey = buildMtmRouteDedupeKey({
      date: routeDate,
      primaryAgentId: normalized.primaryAgentId,
      // A published edit keeps its stored crew (roles included) untouched.
      assignments: isPublishedEdit ? before.assignments : normalized.assignments,
      points: pointInput,
    })
    const duplicate = await prisma.mtmRoute.findFirst({
      where: { organizationId: auth.orgId, dedupeKey, deletedAt: null, id: { not: id } },
      select: { id: true, name: true, date: true, status: true },
    })
    if (duplicate) {
      return NextResponse.json({
        error: "An identical route already exists",
        code: "ROUTE_DUPLICATE",
        duplicate,
      }, { status: 409 })
    }

    const data: Prisma.MtmRouteUncheckedUpdateManyInput = {
      dedupeKey,
      version: { increment: 1 },
    }
    // Route Field reads publishedVersion to know its copy is stale.
    if (isPublishedEdit) data.publishedVersion = body.expectedVersion + 1
    if (body.name !== undefined) data.name = body.name ?? null
    if (!isPublishedEdit && (body.agentId !== undefined || body.assignments !== undefined)) data.agentId = normalized.primaryAgentId
    if (!isPublishedEdit && body.date !== undefined) data.date = routeDate
    if (!isPublishedEdit && body.status !== undefined) data.status = body.status
    if (body.notes !== undefined) data.notes = body.notes ?? null
    if (body.points !== undefined) data.totalPoints = body.points.length

    const planningSignals = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let signals: MtmRoutePlanningSignals | null = null
      if (isPublishedEdit && publishedDiff && body.points) {
        const crewAgentIds = routeCrewAgentIds(before.agentId, before.assignments, { includeObservers: true })
        // Lock order everywhere: schedule → point (check-in's lock) → route.
        await acquireMtmRouteScheduleLocks(tx, { organizationId: auth.orgId, date: before.date, agentIds: crewAgentIds })
        const lockedPoints = await lockPublishedRoutePoints(tx, {
          organizationId: auth.orgId,
          routeId: id,
          pointIds: before.points.map((point: { id: string }) => point.id),
        })
        const freshDiff = lockedPoints ? diffPublishedRoutePoints(lockedPoints, body.points) : null
        if (!freshDiff?.ok || !samePublishedRoutePointDiff(publishedDiff, freshDiff)) {
          throw new PublishedRoutePointsChangedError()
        }

        // The same planning check publish runs, re-read under the locks.
        const existingRoutes = await tx.mtmRoute.findMany({
          where: {
            organizationId: auth.orgId,
            id: { not: id },
            date: before.date,
            status: { in: ["PLANNED", "IN_PROGRESS"] },
            deletedAt: null,
          },
          select: {
            id: true,
            status: true,
            agentId: true,
            assignments: { select: { agentId: true, removedAt: true } },
            points: { select: { customerId: true, contactId: true, plannedTime: true, deletedAt: true } },
          },
        })
        signals = detectMtmRoutePlanningSignals({
          primaryAgentId: before.agentId,
          assignments: before.assignments,
          points: pointInput,
        }, existingRoutes)
        if (signals.conflicts.length > 0) {
          if (!body.overrideReason || actor.role === "AGENT") throw new RouteScheduleConflict(signals.conflicts)
          const now = new Date()
          const evidence = createMtmRouteChangeEvidence({ capturedAt: now, changeType: "CONFLICT_OVERRIDE", route: before })
          const payload = attachMtmRouteChangeEvidence({ dedupeKey, conflicts: signals.conflicts, source: "published_edit" }, evidence)
          const completed = appendMtmRouteChangeEvidenceOutcome({
            payload,
            decision: "APPROVED",
            status: "APPROVED",
            recordedAt: now,
            route: { ...before, version: body.expectedVersion + 1, publishedVersion: body.expectedVersion + 1 },
            routePoint: null,
          }) ?? payload
          await tx.mtmRouteChangeRequest.create({
            data: {
              organizationId: auth.orgId,
              routeId: id,
              requestedByAgentId: actor.agentId ?? before.agentId,
              changeType: "CONFLICT_OVERRIDE",
              status: "APPROVED",
              reason: body.overrideReason,
              payload: completed as unknown as Prisma.InputJsonValue,
              reviewedBy: auth.userId || null,
              decisionComment: body.overrideReason,
              reviewedAt: now,
            },
          })
        }
      }

      const updated = await tx.mtmRoute.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          status: before.status,
          version: body.expectedVersion,
          deletedAt: null,
        },
        data,
      })
      if (updated.count === 0) throw new RouteVersionConflict("Route changed concurrently")

      // A published edit has proven the crew unchanged above. Re-upserting it
      // would reset assignedAt, which bounds historical route access.
      if (!isPublishedEdit && (body.agentId !== undefined || body.assignments !== undefined)) {
        await tx.mtmRouteAssignment.updateMany({
          where: { routeId: id, organizationId: auth.orgId, removedAt: null },
          data: { removedAt: new Date() },
        })
        for (const assignment of normalized.assignments) {
          await tx.mtmRouteAssignment.upsert({
            where: { routeId_agentId: { routeId: id, agentId: assignment.agentId } },
            create: {
              organizationId: auth.orgId,
              routeId: id,
              agentId: assignment.agentId,
              role: assignment.role,
              assignedBy: auth.userId || null,
            },
            update: {
              role: assignment.role,
              assignedBy: auth.userId || null,
              assignedAt: new Date(),
              removedAt: null,
            },
          })
        }
      }

      if (body.points !== undefined) {
        if (before.status === "DRAFT") {
          await tx.mtmRoutePoint.updateMany({
            where: { routeId: id, route: { organizationId: auth.orgId }, deletedAt: null },
            data: { deletedAt: new Date(), version: { increment: 1 } },
          })
          if (body.points.length > 0) {
            await tx.mtmRoutePoint.createMany({
              data: body.points.map((point, index) => ({
                organizationId: auth.orgId,
                routeId: id,
                customerId: point.customerId,
                contactId: point.contactId ?? null,
                orderIndex: index,
                plannedTime: point.plannedTime ? new Date(point.plannedTime) : null,
              })),
            })
          }
        } else if (publishedDiff) {
          await applyPublishedRoutePointDiff(tx, {
            organizationId: auth.orgId,
            routeId: id,
            diff: publishedDiff,
            now: new Date(),
          })
        }
      }

      if (isPublishedEdit) {
        const publishedVersion = body.expectedVersion + 1
        const notifiedAgentIds = routeCrewAgentIds(before.agentId, before.assignments, { includeObservers: false })
        for (const agentId of notifiedAgentIds) {
          await enqueueMtmRouteNotification(tx, {
            organizationId: auth.orgId,
            agentId,
            dedupeKey: `route:${id}:published:${publishedVersion}:${agentId}`,
            title: "Route updated",
            body: `Route for ${before.date.toISOString().slice(0, 10)} was changed.`,
            type: "task",
            metadata: { routeId: id, publishedVersion, event: "route_updated" },
          })
        }
      }
      return signals
    }, { maxWait: 5_000, timeout: 10_000 })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: normalized.primaryAgentId,
      action: MTM_ROUTE_AUDIT_ACTION.ROUTE_UPDATE,
      entity: "route",
      entityId: id,
      metadataKind: "route_update",
      oldData: {
        agentId: before.agentId,
        status: before.status,
        version: before.version,
        totalPoints: before.totalPoints,
        assignments: before.assignments,
        ...(isPublishedEdit ? { publishedVersion: before.publishedVersion, stops: publishedRouteAuditStops(before.points) } : {}),
      },
      newData: {
        ...data,
        version: body.expectedVersion + 1,
        assignments: normalized.assignments,
        ...(publishedDiff && body.points
          ? {
              stops: publishedRouteAuditStops(body.points),
              removedPointIds: publishedDiff.removed.map((point) => point.id),
              coordination: planningSignals?.coordination ?? [],
              managerOverride: Boolean(planningSignals?.conflicts.length),
            }
          : {}),
      },
      req,
    }).catch((error) => console.warn("[MTM/routes/[id] PUT] audit failed", error))

    return NextResponse.json({
      success: true,
      data: { id, version: body.expectedVersion + 1 },
    })
  } catch (error) {
    if (error instanceof RouteScheduleConflict) {
      return NextResponse.json({
        error: error.message,
        code: "ROUTE_CONFLICT",
        conflicts: error.conflicts,
      }, { status: 409 })
    }
    if (
      error instanceof RouteVersionConflict
      || error instanceof PublishedRoutePointsChangedError
      || isRetryableRouteTransactionConflict(error)
    ) {
      const current = await prisma.mtmRoute.findFirst({
        where: { id, organizationId: auth.orgId, deletedAt: null },
        select: { version: true, updatedAt: true, status: true },
      }).catch(() => null)
      return NextResponse.json({
        error: "This route was changed by another user. Reload it before saving.",
        code: "ROUTE_VERSION_CONFLICT",
        currentVersion: current?.version,
        updatedAt: current?.updatedAt,
        status: current?.status,
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "An identical route already exists",
        code: "ROUTE_DUPLICATE",
      }, { status: 409 })
    }
    // Database errors carry SQL, constraint and column names: log them, never
    // echo them to the browser.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      || error instanceof Prisma.PrismaClientUnknownRequestError
      || error instanceof Prisma.PrismaClientValidationError
      || error instanceof Prisma.PrismaClientInitializationError
      || error instanceof Prisma.PrismaClientRustPanicError
    ) {
      console.error("[MTM/routes/[id] PUT]", error)
      return NextResponse.json({ error: "Failed to update route", code: "MTM_ROUTE_UPDATE_FAILED" }, { status: 500 })
    }
    const message = error instanceof Error ? error.message : "Failed to update"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})

export const DELETE = withRouteFieldRlsAuth("delete", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await actorFor(auth)
  if (!actor) return forbidden()

  try {
    const before = await prisma.mtmRoute.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null },
      include: { assignments: { where: { removedAt: null }, select: { agentId: true } } },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!canEditMtmRouteDraft(actor, {
      primaryAgentId: before.agentId,
      assignedAgentIds: before.assignments.map((assignment: Pick<RouteAssignmentRow, "agentId">) => assignment.agentId),
      status: before.status,
    })) {
      return NextResponse.json({
        error: "Only draft routes may be deleted",
        code: "ROUTE_NOT_EDITABLE",
      }, { status: 409 })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.mtmRoutePoint.updateMany({
        where: { routeId: id, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      })
      await tx.mtmRouteAssignment.updateMany({
        where: { routeId: id, organizationId: auth.orgId, removedAt: null },
        data: { removedAt: new Date() },
      })
      await tx.mtmRoute.updateMany({
        where: { id, organizationId: auth.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: before.agentId,
      action: "ROUTE_DELETE",
      entity: "route",
      entityId: id,
      metadataKind: "route_delete",
      oldData: before,
      req,
    }).catch((error) => console.warn("[MTM/routes/[id] DELETE] audit failed", error))

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
