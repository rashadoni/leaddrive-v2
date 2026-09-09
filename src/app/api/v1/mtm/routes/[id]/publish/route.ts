import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { RoutePublishSchema, parseBody } from "@/lib/mtm-validators"
import {
  acquireMtmRouteScheduleLocks,
  detectMtmRouteInternalScheduleConflicts,
  detectMtmRoutePlanningSignals,
  type MtmRouteConflict,
  type MtmRoutePlanningSignals,
} from "@/lib/mtm/route-planning"
import { canPublishMtmRoute, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  appendMtmRouteChangeEvidenceOutcome,
  attachMtmRouteChangeEvidence,
  createMtmRouteChangeEvidence,
} from "@/lib/mtm/route-change-evidence"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function selfPublishEnabled(value: unknown): boolean {
  if (value === true) return true
  return Boolean(value && typeof value === "object" && "enabled" in value && value.enabled === true)
}

class RouteVersionConflict extends Error {}

class RouteScheduleConflict extends Error {
  constructor(readonly conflicts: MtmRouteConflict[]) {
    super("Route conflicts require manager approval")
  }
}

export const POST = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()

  const parsed = parseBody(RoutePublishSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response

  const route = await prisma.mtmRoute.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    include: {
      assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
      points: { where: { deletedAt: null }, select: { customerId: true, contactId: true, plannedTime: true, deletedAt: true } },
    },
  })
  if (!route) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let allowSelfPublish = false
  if (actor.role === "AGENT") {
    const setting = await prisma.mtmSetting.findUnique({
      where: { organizationId_key: { organizationId: auth.orgId, key: "routeSelfPublish" } },
      select: { value: true },
    })
    allowSelfPublish = selfPublishEnabled(setting?.value)
  }
  if (!canPublishMtmRoute(actor, {
    primaryAgentId: route.agentId,
    assignedAgentIds: route.assignments.map((assignment: { agentId: string }) => assignment.agentId),
    status: "DRAFT",
  }, allowSelfPublish)) return forbidden()
  if (route.status === "PLANNED") {
    return NextResponse.json({
      success: true,
      data: {
        id: route.id,
        status: "PLANNED",
        version: route.version,
        publishedVersion: route.publishedVersion,
        publishedAt: route.publishedAt,
      },
      idempotent: true,
    })
  }
  if (route.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft routes may be published", code: "ROUTE_TRANSITION_INVALID" }, { status: 409 })
  }
  if (route.points.length === 0) {
    return NextResponse.json({ error: "A route must contain at least one stop", code: "ROUTE_EMPTY" }, { status: 409 })
  }
  if (parsed.data.expectedVersion !== route.version) {
    return NextResponse.json({
      error: "This route was changed by another user. Reload it before publishing.",
      code: "ROUTE_VERSION_CONFLICT",
      currentVersion: route.version,
      updatedAt: route.updatedAt,
    }, { status: 409 })
  }

  const internalConflicts = detectMtmRouteInternalScheduleConflicts(route.points)
  if (internalConflicts.length > 0) {
    return NextResponse.json({
      error: "Two route stops cannot use the same meeting time",
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: internalConflicts,
    }, { status: 409 })
  }

  const now = new Date()
  const publishedVersion = route.version + 1
  const assignedAgentIds = [...new Set([
    route.agentId,
    ...route.assignments.map((assignment: { agentId: string }) => assignment.agentId),
  ])].sort()
  let publishResult: {
    planningSignals: MtmRoutePlanningSignals
    managerOverride: boolean
  }
  try {
    publishResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await acquireMtmRouteScheduleLocks(tx, {
        organizationId: auth.orgId,
        date: route.date,
        agentIds: assignedAgentIds,
      })

      // Re-read the competing schedules only after the agent/date locks are
      // held. This is the authoritative check; browser preflight cannot close
      // the race between two simultaneous publish requests.
      const existingRoutes = await tx.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          id: { not: route.id },
          date: route.date,
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
      const planningSignals = detectMtmRoutePlanningSignals({
        primaryAgentId: route.agentId,
        assignments: route.assignments,
        points: route.points,
      }, existingRoutes)
      const { conflicts } = planningSignals

      const approvedOverride = conflicts.length > 0
        ? await tx.mtmRouteChangeRequest.findFirst({
            where: {
              organizationId: auth.orgId,
              routeId: route.id,
              changeType: "CONFLICT_OVERRIDE",
              status: "APPROVED",
            },
            orderBy: { reviewedAt: "desc" },
          })
        : null
      const overridePayload = approvedOverride?.payload
      const overrideMatches = Boolean(
        overridePayload &&
        typeof overridePayload === "object" &&
        !Array.isArray(overridePayload) &&
        "dedupeKey" in overridePayload &&
        overridePayload.dedupeKey === route.dedupeKey,
      )
      const managerOverride = Boolean(
        conflicts.length > 0 && parsed.data.overrideReason && actor.role !== "AGENT",
      )
      if (conflicts.length > 0 && !overrideMatches && !managerOverride) {
        throw new RouteScheduleConflict(conflicts)
      }

      if (managerOverride) {
        const overrideEvidence = createMtmRouteChangeEvidence({
          capturedAt: now,
          changeType: "CONFLICT_OVERRIDE",
          route,
        })
        const overridePayload = attachMtmRouteChangeEvidence({ dedupeKey: route.dedupeKey, conflicts }, overrideEvidence)
        const completedOverridePayload = appendMtmRouteChangeEvidenceOutcome({
          payload: overridePayload,
          decision: "APPROVED",
          status: "APPROVED",
          recordedAt: now,
          route: {
            ...route,
            status: "PLANNED",
            version: publishedVersion,
            publishedVersion,
          },
          routePoint: null,
        }) ?? overridePayload
        await tx.mtmRouteChangeRequest.create({
          data: {
            organizationId: auth.orgId,
            routeId: route.id,
            requestedByAgentId: actor.agentId ?? route.agentId,
            changeType: "CONFLICT_OVERRIDE",
            status: "APPROVED",
            reason: parsed.data.overrideReason!,
            payload: completedOverridePayload as unknown as Prisma.InputJsonValue,
            reviewedBy: auth.userId || null,
            decisionComment: parsed.data.overrideReason!,
            reviewedAt: now,
          },
        })
      }
      const updated = await tx.mtmRoute.updateMany({
        where: {
          id: route.id,
          organizationId: auth.orgId,
          status: "DRAFT",
          version: parsed.data.expectedVersion,
          deletedAt: null,
        },
        data: {
          status: "PLANNED",
          version: { increment: 1 },
          publishedVersion,
          publishedAt: now,
          publishedBy: auth.userId || null,
        },
      })
      if (updated.count !== 1) throw new RouteVersionConflict("Route changed concurrently")

      if (assignedAgentIds.length > 0) {
        for (const agentId of assignedAgentIds) {
          await enqueueMtmRouteNotification(tx, {
            organizationId: auth.orgId,
            agentId,
            dedupeKey: `route:${route.id}:published:${publishedVersion}:${agentId}`,
            title: "Route published",
            body: `Route for ${route.date.toISOString().slice(0, 10)} is ready.`,
            type: "task",
            metadata: {
              routeId: route.id,
              publishedVersion,
              event: "route_published",
            },
          })
        }
      }
      return { planningSignals, managerOverride }
    }, { maxWait: 5_000, timeout: 10_000 })
  } catch (error) {
    if (error instanceof RouteScheduleConflict) {
      return NextResponse.json({
        error: error.message,
        code: "ROUTE_CONFLICT",
        conflicts: error.conflicts,
      }, { status: 409 })
    }
    if (error instanceof RouteVersionConflict) {
      const current = await prisma.mtmRoute.findFirst({
        where: { id: route.id, organizationId: auth.orgId, deletedAt: null },
        select: { version: true, publishedVersion: true, updatedAt: true, status: true },
      }).catch(() => null)
      return NextResponse.json({
        error: "This route was changed by another user. Reload it before publishing.",
        code: "ROUTE_VERSION_CONFLICT",
        currentVersion: current?.version,
        publishedVersion: current?.publishedVersion,
        updatedAt: current?.updatedAt,
        status: current?.status,
      }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: route.agentId,
    action: MTM_ROUTE_AUDIT_ACTION.ROUTE_PUBLISH,
    entity: "route",
    entityId: route.id,
    metadataKind: "route_publish",
    oldData: { status: route.status, version: route.version },
    newData: {
      status: "PLANNED",
      version: publishedVersion,
      publishedVersion,
      conflicts: publishResult.planningSignals.conflicts,
      coordination: publishResult.planningSignals.coordination,
      managerOverride: publishResult.managerOverride,
    },
    req,
  }).catch((error) => console.warn("[MTM/routes/[id]/publish] audit failed", error))

  return NextResponse.json({
    success: true,
    data: {
      id: route.id,
      status: "PLANNED",
      version: publishedVersion,
      publishedVersion,
      publishedAt: now,
    },
    meta: { coordination: publishResult.planningSignals.coordination },
  })
})
