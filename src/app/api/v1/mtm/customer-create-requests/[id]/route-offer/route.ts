import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  canEditMtmRouteDraft,
  canReviewMtmRouteRequest,
  canViewMtmRoute,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { buildMtmRouteDedupeKey } from "@/lib/mtm/route-planning"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { attachMtmRouteChangeEvidence, createMtmRouteChangeEvidence } from "@/lib/mtm/route-change-evidence"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

function routeOfferReplay(request: { routeChangeRequestId: string | null }) {
  return NextResponse.json({
    success: true,
    data: { mode: request.routeChangeRequestId ? "APPROVAL" : "DIRECT", routeChangeRequestId: request.routeChangeRequestId },
    idempotent: true,
  })
}

export const POST = withRouteFieldWebRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const request = await prisma.mtmCustomerCreateRequest.findFirst({
    where: { id, organizationId: auth.orgId },
    include: {
      approvedCustomer: { select: { id: true, name: true } },
      route: {
        include: {
          assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
          points: { where: { deletedAt: null }, select: { customerId: true, contactId: true, orderIndex: true, plannedTime: true }, orderBy: { orderIndex: "asc" } },
        },
      },
    },
  })
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (request.status !== "APPROVED" || !request.approvedCustomer || !request.route) {
    return NextResponse.json({ error: "Approved customer and linked route are required", code: "ROUTE_OFFER_UNAVAILABLE" }, { status: 409 })
  }
  if (actor.agentId !== request.requestedByAgentId && !canReviewMtmRouteRequest(actor, request.requestedByAgentId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const route = request.route
  const assignedAgentIds = route.assignments.map((assignment: { agentId: string }) => assignment.agentId)
  if (!canViewMtmRoute(actor, { primaryAgentId: route.agentId, assignedAgentIds, status: route.status })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (request.routeOfferAcceptedAt) {
    return routeOfferReplay(request)
  }
  if (route.points.some((point: { customerId: string }) => point.customerId === request.approvedCustomerId)) {
    return NextResponse.json({ success: true, data: { mode: "ALREADY_ADDED" }, idempotent: true })
  }

  const now = new Date()
  if (route.status === "DRAFT") {
    if (!canEditMtmRouteDraft(actor, { primaryAgentId: route.agentId, assignedAgentIds, status: route.status })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const points = [...route.points.map((point: { customerId: string; contactId: string | null; plannedTime: Date | null }) => ({
      customerId: point.customerId,
      contactId: point.contactId,
      plannedTime: point.plannedTime,
    })), { customerId: request.approvedCustomer.id, contactId: null, plannedTime: null }]
    const dedupeKey = buildMtmRouteDedupeKey({
      date: route.date,
      primaryAgentId: route.agentId,
      assignments: route.assignments,
      points,
    })
    const duplicate = await prisma.mtmRoute.findFirst({
      where: { organizationId: auth.orgId, dedupeKey, deletedAt: null, id: { not: route.id } },
      select: { id: true, name: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: "An identical route already exists", code: "ROUTE_DUPLICATE", duplicate }, { status: 409 })
    }

    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const claimed = await tx.mtmCustomerCreateRequest.updateMany({
          where: { id, organizationId: auth.orgId, status: "APPROVED", routeOfferAcceptedAt: null },
          data: { routeOfferAcceptedAt: now },
        })
        if (claimed.count !== 1) throw new Error("Route offer already accepted")
        const updated = await tx.mtmRoute.updateMany({
          where: {
            id: route.id,
            organizationId: auth.orgId,
            status: "DRAFT",
            version: route.version,
            deletedAt: null,
          },
          data: { dedupeKey, totalPoints: points.length, version: { increment: 1 } },
        })
        if (updated.count !== 1) throw new Error("Route changed concurrently")
        await tx.mtmRoutePoint.create({
          data: {
            organizationId: auth.orgId,
            routeId: route.id,
            customerId: request.approvedCustomer!.id,
            orderIndex: route.points.length,
          },
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      if (error instanceof Error && error.message === "Route offer already accepted") {
        const current = await prisma.mtmCustomerCreateRequest.findUnique({ where: { id }, select: { routeChangeRequestId: true } })
        if (current) return routeOfferReplay(current)
      }
      throw error
    }
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: request.requestedByAgentId,
      action: MTM_ROUTE_AUDIT_ACTION.ROUTE_UPDATE,
      entity: "route",
      entityId: route.id,
      metadataKind: "approved_customer_route_offer",
      newData: { customerId: request.approvedCustomer.id, customerRequestId: request.id, mode: "DIRECT" },
      req,
    }).catch((error) => console.warn("[MTM/customer-create-requests/route-offer] audit failed", error))
    return NextResponse.json({
      success: true,
      data: { mode: "DIRECT", routeId: route.id, version: route.version + 1 },
    })
  }

  if (route.status !== "PLANNED" && route.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Route cannot accept new stops", code: "ROUTE_TRANSITION_INVALID" }, { status: 409 })
  }

  const requester = await prisma.mtmAgent.findFirst({
    where: { id: request.requestedByAgentId, organizationId: auth.orgId },
    select: { managerId: true, name: true },
  })
  let changeRequest
  try {
    changeRequest = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.mtmCustomerCreateRequest.updateMany({
        where: { id, organizationId: auth.orgId, status: "APPROVED", routeOfferAcceptedAt: null },
        data: { routeOfferAcceptedAt: now },
      })
      if (claimed.count !== 1) throw new Error("Route offer already accepted")
      const evidence = createMtmRouteChangeEvidence({
        capturedAt: now,
        changeType: "ADD_STOP",
        route,
        target: { customerId: request.approvedCustomer!.id, contactId: null },
      })
      const created = await tx.mtmRouteChangeRequest.create({
        data: {
          organizationId: auth.orgId,
          routeId: route.id,
          requestedByAgentId: request.requestedByAgentId,
          changeType: "ADD_STOP",
          status: "SUBMITTED",
          reason: `Add newly approved customer ${request.approvedCustomer!.name}`,
          payload: attachMtmRouteChangeEvidence({
            customerId: request.approvedCustomer!.id,
            customerRequestId: request.id,
          }, evidence) as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.mtmCustomerCreateRequest.update({ where: { id }, data: { routeChangeRequestId: created.id } })
      if (requester?.managerId) {
        await enqueueMtmRouteNotification(tx, {
          organizationId: auth.orgId,
          agentId: requester.managerId,
          dedupeKey: `route-change-request:${created.id}:manager-review:${requester.managerId}`,
          title: "Route stop addition needs approval",
          body: `${requester.name} wants to add ${request.approvedCustomer!.name} to an active route.`,
          type: "task",
          metadata: { routeId: route.id, requestId: created.id, changeType: "ADD_STOP" },
        })
      }
      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof Error && error.message === "Route offer already accepted") {
      const current = await prisma.mtmCustomerCreateRequest.findUnique({ where: { id }, select: { routeChangeRequestId: true } })
      if (current) return routeOfferReplay(current)
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: request.requestedByAgentId,
    action: MTM_ROUTE_AUDIT_ACTION.ROUTE_ADDITION_REQUEST,
    entity: "route_change_request",
    entityId: changeRequest.id,
    metadataKind: "approved_customer_route_offer",
    newData: { customerId: request.approvedCustomer.id, customerRequestId: request.id, mode: "APPROVAL" },
    req,
  }).catch((error) => console.warn("[MTM/customer-create-requests/route-offer] audit failed", error))

  return NextResponse.json({ success: true, data: { mode: "APPROVAL", routeChangeRequestId: changeRequest.id } })
})
