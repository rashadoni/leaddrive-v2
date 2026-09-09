import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { RouteChangeRequestSchema, parseBody } from "@/lib/mtm-validators"
import { canViewMtmRoute, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import {
  mtmRouteTargetKey,
  validateMtmMobileRouteTargetEligibility,
  validateMtmRouteTargets,
} from "@/lib/mtm/route-targets"
import { attachMtmRouteChangeEvidence, createMtmRouteChangeEvidence } from "@/lib/mtm/route-change-evidence"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function mobileTargetAssignmentRequired() {
  return NextResponse.json({
    error: "Route target is unavailable for this employee on this date",
    code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED",
  }, { status: 403 })
}

function payloadRouteTarget(payload: Prisma.JsonValue | null): { customerId: string; contactId: string | null } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  if (typeof payload.customerId !== "string") return null
  return {
    customerId: payload.customerId,
    contactId: typeof payload.contactId === "string" ? payload.contactId : null,
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
  if (!actor?.agentId && actor?.role !== "ADMIN") return forbidden()

  const parsed = parseBody(RouteChangeRequestSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const route = await prisma.mtmRoute.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    include: {
      assignments: { where: { removedAt: null }, select: { agentId: true } },
      points: {
        where: { deletedAt: null },
        select: {
          id: true,
          status: true,
          customerId: true,
          contactId: true,
          orderIndex: true,
          plannedTime: true,
          deletedAt: true,
          visits: { where: { deletedAt: null }, select: { id: true }, take: 1 },
        },
      },
    },
  })
  if (!route) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canViewMtmRoute(actor!, {
    primaryAgentId: route.agentId,
    assignedAgentIds: route.assignments.map((assignment: { agentId: string }) => assignment.agentId),
    status: route.status,
  })) return forbidden()

  if (body.changeType === "REMOVE_STOP") {
    if (route.status !== "PLANNED" && route.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Stop removal approval applies to published routes", code: "ROUTE_TRANSITION_INVALID" }, { status: 409 })
    }
    const routePoint = route.points.find((point: { id: string; visits: Array<{ id: string }> }) => point.id === body.routePointId)
    if (!routePoint) {
      return NextResponse.json({ error: "Route stop not found", code: "ROUTE_POINT_NOT_FOUND" }, { status: 404 })
    }
    if ((routePoint.visits?.length ?? 0) > 0) {
      return NextResponse.json({ error: "A stop with a started visit cannot be removed", code: "ROUTE_POINT_VISIT_STARTED" }, { status: 409 })
    }
    if (routePoint.status !== "PENDING") {
      return NextResponse.json({ error: "Only a pending stop can be cancelled", code: "ROUTE_POINT_ALREADY_RESOLVED" }, { status: 409 })
    }
  } else if (body.changeType === "ADD_STOP") {
    if (route.status !== "PLANNED" && route.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Stop addition approval applies to published routes", code: "ROUTE_TRANSITION_INVALID" }, { status: 409 })
    }
    const customerId = String(body.payload?.customerId)
    const contactId = typeof body.payload?.contactId === "string" ? body.payload.contactId : null
    const target = { customerId, contactId }
    const [targetValidation, mobileTargetEligibility] = await Promise.all([
      validateMtmRouteTargets(prisma, {
        organizationId: auth.orgId,
        routeDate: route.date,
        points: [target],
      }),
      auth.principal === "mobile"
        ? validateMtmMobileRouteTargetEligibility(prisma, {
            organizationId: auth.orgId,
            primaryAgentId: route.agentId,
            routeDate: route.date,
            points: [target],
          })
        : Promise.resolve({ ok: true }),
    ])
    if (!targetValidation.ok) {
      return NextResponse.json({ error: "Route target is invalid", code: "MTM_ROUTE_REFERENCE_INVALID", details: targetValidation }, { status: 400 })
    }
    if (!mobileTargetEligibility.ok) return mobileTargetAssignmentRequired()
    if (route.points.some((point: { customerId: string; contactId: string | null }) => mtmRouteTargetKey(point) === mtmRouteTargetKey(target))) {
      return NextResponse.json({ error: "Customer or contact is already in the route", code: "ROUTE_TARGET_DUPLICATE" }, { status: 409 })
    }
  } else if (route.status !== "DRAFT") {
    return NextResponse.json({ error: "Conflict override applies to draft routes", code: "ROUTE_TRANSITION_INVALID" }, { status: 409 })
  }

  const requestedByAgentId = actor!.agentId ?? route.agentId
  const existingWhere: Prisma.MtmRouteChangeRequestWhereInput = {
      organizationId: auth.orgId,
      routeId: route.id,
      routePointId: body.routePointId ?? null,
      requestedByAgentId,
      changeType: body.changeType,
      status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
  }
  const existingCandidates = await prisma.mtmRouteChangeRequest.findMany({ where: existingWhere })
  const existing = body.changeType === "ADD_STOP"
    ? existingCandidates.find((candidate: { payload: Prisma.JsonValue | null }) => {
        const candidateTarget = payloadRouteTarget(candidate.payload)
        const requestedTarget = payloadRouteTarget((body.payload ?? null) as Prisma.JsonValue | null)
        return Boolean(
          candidateTarget &&
          requestedTarget &&
          mtmRouteTargetKey(candidateTarget) === mtmRouteTargetKey(requestedTarget),
        )
      })
    : existingCandidates[0]
  if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true })

  const evidencePoint = body.routePointId
    ? route.points.find((point: { id: string }) => point.id === body.routePointId) ?? null
    : null
  const evidenceTarget = body.changeType === "ADD_STOP" && typeof body.payload?.customerId === "string"
    ? {
        customerId: body.payload.customerId,
        contactId: typeof body.payload.contactId === "string" ? body.payload.contactId : null,
      }
    : null
  const evidence = createMtmRouteChangeEvidence({
    changeType: body.changeType,
    route,
    routePoint: evidencePoint,
    target: evidenceTarget,
  })

  const requester = await prisma.mtmAgent.findFirst({
    where: { id: requestedByAgentId, organizationId: auth.orgId },
    select: { managerId: true, name: true },
  })
  const request = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.mtmRouteChangeRequest.create({
      data: {
        organizationId: auth.orgId,
        routeId: route.id,
        routePointId: body.routePointId ?? null,
        requestedByAgentId,
        changeType: body.changeType,
        status: "SUBMITTED",
        reason: body.reason,
        payload: attachMtmRouteChangeEvidence({
          ...(body.payload ?? {}),
          dedupeKey: route.dedupeKey,
        }, evidence) as unknown as Prisma.InputJsonValue,
      },
    })
    if (requester?.managerId) {
      await enqueueMtmRouteNotification(tx, {
        organizationId: auth.orgId,
        agentId: requester.managerId,
        dedupeKey: `route-change-request:${created.id}:manager-review:${requester.managerId}`,
        title: "Route change needs approval",
        body: `${requester.name} submitted a route change request.`,
        type: "task",
        metadata: { routeId: route.id, requestId: created.id, changeType: body.changeType },
      })
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: requestedByAgentId,
        action: body.changeType === "REMOVE_STOP"
          ? MTM_ROUTE_AUDIT_ACTION.ROUTE_REMOVAL_REQUEST
          : body.changeType === "ADD_STOP"
            ? MTM_ROUTE_AUDIT_ACTION.ROUTE_ADDITION_REQUEST
            : MTM_ROUTE_AUDIT_ACTION.ROUTE_CONFLICT_OVERRIDE,
        entity: "route_change_request",
        entityId: created.id,
        metadataKind: body.changeType === "REMOVE_STOP"
          ? "route_removal_request"
          : body.changeType === "ADD_STOP"
            ? "route_addition_request"
            : "route_conflict_request",
        newData: created as unknown as Prisma.InputJsonValue,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
      },
    })
    return created
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  return NextResponse.json({ success: true, data: request }, { status: 201 })
})
