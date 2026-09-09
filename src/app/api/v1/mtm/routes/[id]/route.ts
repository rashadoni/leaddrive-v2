import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hasMtmCoordinates, withNormalizedCoordinates } from "@/lib/mtm/geo-coordinates"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { calculateDistance } from "@/lib/geo-utils"
import { RouteUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { buildMtmRouteDedupeKey, normalizeMtmRouteAssignments } from "@/lib/mtm/route-planning"
import {
  canAssignMtmRouteAgents,
  canEditMtmRouteDraft,
  canViewMtmRoute,
  isAgentInRouteScope,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  mtmRouteTargetKey,
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
  }
}

class RouteVersionConflict extends Error {}

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
      return { ...point, customer, distanceMeters }
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
          select: { id: true, customerId: true, contactId: true, plannedTime: true, orderIndex: true, status: true },
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
    if (before.status !== "DRAFT") {
      return NextResponse.json({
        error: "Published routes are immutable. Submit a route change request.",
        code: "ROUTE_PUBLISHED_IMMUTABLE",
        currentVersion: before.version,
      }, { status: 409 })
    }
    if (!canEditMtmRouteDraft(actor, {
      primaryAgentId: before.agentId,
      assignedAgentIds,
      status: before.status,
    })) {
      return NextResponse.json({
        error: "This route can no longer be edited",
        code: "ROUTE_NOT_EDITABLE",
      }, { status: 409 })
    }
    if (body.status && body.status !== "DRAFT" && body.status !== "CANCELLED") {
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

    const pointInput = body.points ?? before.points.map((point: Pick<RoutePointRow, "customerId" | "contactId" | "plannedTime">) => ({
      customerId: point.customerId,
      contactId: point.contactId,
      plannedTime: point.plannedTime,
    }))
    if (body.points !== undefined && before.status === "IN_PROGRESS") {
      const lockedTargets = before.points
        .filter((point: RoutePointRow) => point.status !== "PENDING")
        .map((point: RoutePointRow) => mtmRouteTargetKey(point))
      const requestedLockedTargets = body.points
        .map(mtmRouteTargetKey)
        .filter((target) => lockedTargets.includes(target))
      if (
        requestedLockedTargets.length !== lockedTargets.length ||
        requestedLockedTargets.some((target, index) => target !== lockedTargets[index])
      ) {
        return NextResponse.json({
          error: "Visited or skipped stops cannot be removed or reordered",
          code: "ROUTE_VISITED_POINTS_LOCKED",
        }, { status: 409 })
      }
    }
    const agentIds = [...new Set(normalized.assignments.map((assignment) => assignment.agentId))]
    const routeDate = body.date ? new Date(body.date) : before.date
    const primaryAgentChanged = normalized.primaryAgentId !== before.agentId
    const routeDateChanged = routeDate.getTime() !== before.date.getTime()
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
        points: pointInput,
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
      assignments: normalized.assignments,
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
    if (body.name !== undefined) data.name = body.name ?? null
    if (body.agentId !== undefined || body.assignments !== undefined) data.agentId = normalized.primaryAgentId
    if (body.date !== undefined) data.date = routeDate
    if (body.status !== undefined) data.status = body.status
    if (body.notes !== undefined) data.notes = body.notes ?? null
    if (body.points !== undefined) data.totalPoints = body.points.length

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.mtmRoute.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          status: "DRAFT",
          version: body.expectedVersion,
          deletedAt: null,
        },
        data,
      })
      if (updated.count === 0) throw new RouteVersionConflict("Route changed concurrently")

      if (body.agentId !== undefined || body.assignments !== undefined) {
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
        } else {
          const existingByTarget = new Map<string, RoutePointRow>(
            before.points.map((point: RoutePointRow) => [mtmRouteTargetKey(point), point]),
          )
          const requestedTargets = new Set(body.points.map(mtmRouteTargetKey))
          const removablePointIds = before.points
            .filter((point: RoutePointRow) => point.status === "PENDING" && !requestedTargets.has(mtmRouteTargetKey(point)))
            .map((point: RoutePointRow) => point.id)

          if (removablePointIds.length > 0) {
            const removed = await tx.mtmRoutePoint.updateMany({
              where: {
                id: { in: removablePointIds },
                routeId: id,
                route: { organizationId: auth.orgId },
                status: "PENDING",
                deletedAt: null,
              },
              data: { deletedAt: new Date(), version: { increment: 1 } },
            })
            if (removed.count !== removablePointIds.length) {
              throw new Error("Route points changed concurrently")
            }
          }

          for (const [index, point] of body.points.entries()) {
            const existing = existingByTarget.get(mtmRouteTargetKey(point))
            if (!existing) continue
            const plannedTime = point.plannedTime ? new Date(point.plannedTime) : null
            const timeChanged = existing.plannedTime?.getTime() !== plannedTime?.getTime()
            if (existing.orderIndex === index && !timeChanged) continue
            await tx.mtmRoutePoint.updateMany({
              where: { id: existing.id, routeId: id, route: { organizationId: auth.orgId }, deletedAt: null },
              data: {
                orderIndex: index,
                plannedTime,
                version: { increment: 1 },
              },
            })
          }

          const addedPoints = body.points
            .map((point, index) => ({ point, index }))
            .filter(({ point }) => !existingByTarget.has(mtmRouteTargetKey(point)))
          if (addedPoints.length > 0) {
            await tx.mtmRoutePoint.createMany({
              data: addedPoints.map(({ point, index }) => ({
                organizationId: auth.orgId,
                routeId: id,
                customerId: point.customerId,
                contactId: point.contactId ?? null,
                orderIndex: index,
                plannedTime: point.plannedTime ? new Date(point.plannedTime) : null,
              })),
            })
          }
        }
      }

    })

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
      },
      newData: {
        ...data,
        version: body.expectedVersion + 1,
        assignments: normalized.assignments,
      },
      req,
    }).catch((error) => console.warn("[MTM/routes/[id] PUT] audit failed", error))

    return NextResponse.json({
      success: true,
      data: { id, version: body.expectedVersion + 1 },
    })
  } catch (error) {
    if (error instanceof RouteVersionConflict) {
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
