import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { RouteCreateSchema, parseBody } from "@/lib/mtm-validators"
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
  canAssignMtmRouteAgents,
  canCreateMtmRouteFor,
  isAgentInRouteScope,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { validateMtmMobileRouteTargetEligibility, validateMtmRouteTargets } from "@/lib/mtm/route-targets"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

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
        select: { id: true, name: true, address: true },
      },
      contact: {
        select: { id: true, displayName: true, type: true, specialtyName: true, phone: true },
      },
    },
    orderBy: { orderIndex: "asc" as const },
  },
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function mobileTargetAssignmentRequired() {
  return NextResponse.json({
    error: "Route target is unavailable for this employee on this date",
    code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED",
  }, { status: 403 })
}

function settingEnabled(value: unknown): boolean {
  if (value === true) return true
  return Boolean(value && typeof value === "object" && "enabled" in value && value.enabled === true)
}

class RouteCreateScheduleConflict extends Error {
  constructor(readonly conflicts: MtmRouteConflict[]) {
    super("Route conflicts require draft review and manager approval")
  }
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const date = searchParams.get("date") || ""
  const start = searchParams.get("start") || ""
  const endExclusive = searchParams.get("endExclusive") || ""
  const status = searchParams.get("status") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  if ((start || endExclusive) && (!isDateKey(start) || !isDateKey(endExclusive) || endExclusive <= start)) {
    return NextResponse.json({ error: "Invalid route date range", code: "MTM_ROUTE_RANGE_INVALID" }, { status: 400 })
  }
  if (date && (!isDateKey(date) || start || endExclusive)) {
    return NextResponse.json({ error: "Invalid route date filter", code: "MTM_ROUTE_DATE_INVALID" }, { status: 400 })
  }
  if (start && endExclusive > addDateKeyDays(start, 367)) {
    return NextResponse.json({ error: "Route range may not exceed 367 days", code: "MTM_ROUTE_RANGE_TOO_LARGE" }, { status: 400 })
  }

  if (agentId && !isAgentInRouteScope(actor, agentId)) return forbidden()

  try {
    const where: Prisma.MtmRouteWhereInput = { organizationId: auth.orgId, deletedAt: null }
    if (actor.scopedAgentIds !== null) {
      where.OR = [
        { agentId: { in: [...actor.scopedAgentIds] } },
        { assignments: { some: { agentId: { in: [...actor.scopedAgentIds] }, removedAt: null } } },
      ]
    }
    if (agentId) {
      where.AND = [{
        OR: [
          { agentId },
          { assignments: { some: { agentId, removedAt: null } } },
        ],
      }]
    }
    if (status) where.status = status as Prisma.EnumMtmRouteStatusFilter
    if (date) {
      where.date = { gte: new Date(`${date}T00:00:00.000Z`), lt: new Date(`${addDateKeyDays(date, 1)}T00:00:00.000Z`) }
    } else if (start) {
      where.date = {
        gte: new Date(`${start}T00:00:00.000Z`),
        lt: new Date(`${endExclusive}T00:00:00.000Z`),
      }
    }

    const [routes, total, selfPublishSetting] = await Promise.all([
      prisma.mtmRoute.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: routeInclude,
      }),
      prisma.mtmRoute.count({ where }),
      actor.role === "AGENT"
        ? prisma.mtmSetting.findUnique({
            where: { organizationId_key: { organizationId: auth.orgId, key: "routeSelfPublish" } },
            select: { value: true },
          })
        : Promise.resolve(null),
    ])

    return NextResponse.json({
      success: true,
      data: {
        routes,
        total,
        page,
        limit,
        capabilities: {
          canCreateRoute: actor.role !== "AGENT" || actor.canPlanOwnRoutes !== false,
          canPublish: actor.role !== "AGENT" || (
            actor.canPlanOwnRoutes !== false
            && actor.canSelfPublishRoutes === true
            && settingEnabled(selfPublishSetting?.value)
          ),
          canReview: actor.role === "ADMIN" || actor.role === "MANAGER" || actor.role === "SUPERVISOR",
          canRequestCustomer: actor.agentId !== null,
          actorAgentId: actor.agentId,
        },
      },
    })
  } catch (error) {
    console.error("[MTM/routes GET]", error)
    return NextResponse.json({ error: "Failed to load routes" }, { status: 500 })
  }
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  try {
    const raw = await req.json()
    const parsed = parseBody(RouteCreateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const settings = await getMtmSettings(auth.orgId)
    if (!settings.routeAssignmentsEnabled && (body.assignments?.length ?? 0) > 1) {
      return NextResponse.json({ error: "Multi-agent route assignments are disabled", code: "MTM_ROUTE_ASSIGNMENTS_DISABLED" }, { status: 409 })
    }
    const normalized = normalizeMtmRouteAssignments(body.agentId, body.assignments)
    const participantIds = normalized.assignments
      .filter((assignment) => assignment.role !== "PRIMARY")
      .map((assignment) => assignment.agentId)

    if (!canCreateMtmRouteFor(actor, normalized.primaryAgentId)) return forbidden()
    if (!canAssignMtmRouteAgents(actor, normalized.primaryAgentId, participantIds)) return forbidden()

    const agentIds = [...new Set(normalized.assignments.map((assignment) => assignment.agentId))]
    const routeDate = new Date(body.date)
    const [agents, targetValidation, mobileTargetEligibility] = await Promise.all([
      prisma.mtmAgent.findMany({
        where: { organizationId: auth.orgId, id: { in: agentIds }, status: "ACTIVE" },
        select: { id: true, teamId: true },
      }),
      validateMtmRouteTargets(prisma, {
        organizationId: auth.orgId,
        routeDate,
        points: body.points ?? [],
      }),
      auth.principal === "mobile"
        ? validateMtmMobileRouteTargetEligibility(prisma, {
            organizationId: auth.orgId,
            primaryAgentId: normalized.primaryAgentId,
            routeDate,
            points: body.points ?? [],
          })
        : Promise.resolve({ ok: true }),
    ])
    const foundAgentIds = new Set(agents.map((agent: { id: string }) => agent.id))
    const missingAgentIds = agentIds.filter((id) => !foundAgentIds.has(id))
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
      points: body.points ?? [],
    })
    const duplicate = await prisma.mtmRoute.findFirst({
      where: { organizationId: auth.orgId, dedupeKey, deletedAt: null },
      select: { id: true, name: true, date: true, status: true },
    })
    if (duplicate) {
      return NextResponse.json({
        error: "An identical route already exists",
        code: "ROUTE_DUPLICATE",
        duplicate,
      }, { status: 409 })
    }

    const existingRoutes = await prisma.mtmRoute.findMany({
      where: {
        organizationId: auth.orgId,
        date: routeDate,
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
    const preflightSignals = detectMtmRoutePlanningSignals({
      primaryAgentId: normalized.primaryAgentId,
      assignments: normalized.assignments,
      points: body.points ?? [],
    }, existingRoutes)

    const legacyPayload = body.assignments === undefined
    const status = body.status ?? (legacyPayload ? "PLANNED" : "DRAFT")
    if (status === "PLANNED") {
      const internalConflicts = detectMtmRouteInternalScheduleConflicts(body.points ?? [])
      if (internalConflicts.length > 0) {
        return NextResponse.json({
          error: "Two route stops cannot use the same meeting time",
          code: "ROUTE_POINT_TIME_CONFLICT",
          conflicts: internalConflicts,
        }, { status: 409 })
      }
    }
    const now = new Date()
    const transactionResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let planningSignals: MtmRoutePlanningSignals = preflightSignals
      if (status === "PLANNED") {
        await acquireMtmRouteScheduleLocks(tx, {
          organizationId: auth.orgId,
          date: routeDate,
          agentIds,
        })

        // The locked read is authoritative. It prevents two legacy clients
        // from both passing an optimistic preflight and publishing overlapping
        // schedules at the same time.
        const lockedExistingRoutes = await tx.mtmRoute.findMany({
          where: {
            organizationId: auth.orgId,
            date: routeDate,
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
        planningSignals = detectMtmRoutePlanningSignals({
          primaryAgentId: normalized.primaryAgentId,
          assignments: normalized.assignments,
          points: body.points ?? [],
        }, lockedExistingRoutes)
        if (planningSignals.conflicts.length > 0) {
          throw new RouteCreateScheduleConflict(planningSignals.conflicts)
        }
      }

      const created = await tx.mtmRoute.create({
        data: {
          organizationId: auth.orgId,
          agentId: normalized.primaryAgentId,
          date: routeDate,
          name: body.name ?? null,
          notes: body.notes ?? null,
          status,
          dedupeKey,
          totalPoints: body.points?.length ?? 0,
          publishedVersion: status === "PLANNED" ? 1 : null,
          publishedAt: status === "PLANNED" ? now : null,
          publishedBy: status === "PLANNED" ? auth.userId || null : null,
          assignments: {
            create: normalized.assignments.map((assignment) => ({
              organizationId: auth.orgId,
              agentId: assignment.agentId,
              role: assignment.role,
              assignedBy: auth.userId || null,
            })),
          },
          points: body.points
            ? {
                create: body.points.map((point, index) => ({
                  organizationId: auth.orgId,
                  customerId: point.customerId,
                  contactId: point.contactId ?? null,
                  orderIndex: index,
                  plannedTime: point.plannedTime ? new Date(point.plannedTime) : null,
                })),
              }
            : undefined,
        },
        include: routeInclude,
      })
      if (status === "PLANNED") {
        const assignedAgentIds = [...new Set(normalized.assignments.map((assignment) => assignment.agentId))]
        for (const agentId of assignedAgentIds) {
          await enqueueMtmRouteNotification(tx, {
            organizationId: auth.orgId,
            agentId,
            dedupeKey: `route:${created.id}:published:1:${agentId}`,
            title: "Route published",
            body: `Route for ${routeDate.toISOString().slice(0, 10)} is ready.`,
            type: "task",
            metadata: {
              routeId: created.id,
              publishedVersion: 1,
              event: "route_published",
            },
          })
        }
      }
      return { route: created, planningSignals }
    }, { maxWait: 5_000, timeout: 10_000 })
    const { route, planningSignals } = transactionResult

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: normalized.primaryAgentId,
      action: MTM_ROUTE_AUDIT_ACTION.ROUTE_CREATE,
      entity: "route",
      entityId: route.id,
      metadataKind: "route_create",
      newData: {
        primaryAgentId: normalized.primaryAgentId,
        assignments: normalized.assignments,
        date: body.date,
        status,
        totalPoints: route.totalPoints,
        conflicts: planningSignals.conflicts,
        coordination: planningSignals.coordination,
      },
      req,
    }).catch((error) => console.warn("[MTM/routes POST] audit failed", error))

    return NextResponse.json({ success: true, data: route, meta: planningSignals }, { status: 201 })
  } catch (error) {
    if (error instanceof RouteCreateScheduleConflict) {
      return NextResponse.json({
        error: error.message,
        code: "ROUTE_CONFLICT",
        conflicts: error.conflicts,
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "An identical route already exists",
        code: "ROUTE_DUPLICATE",
      }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : "Failed to create route"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
