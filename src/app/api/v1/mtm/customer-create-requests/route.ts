import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { CustomerCreateRequestSchema, parseBody } from "@/lib/mtm-validators"
import { canViewMtmRoute, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  rankMtmCustomerDuplicates,
  type MtmCustomerDuplicateRow,
} from "@/lib/mtm/customer-request"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

const duplicateSelect = {
  id: true,
  code: true,
  name: true,
  phone: true,
  address: true,
  latitude: true,
  longitude: true,
} as const

const requestInclude = {
  requestedByAgent: { select: { id: true, name: true } },
  route: { select: { id: true, name: true, status: true } },
  approvedCustomer: { select: { id: true, code: true, name: true } },
} as const

type CustomerRequestListRow = Prisma.MtmCustomerCreateRequestGetPayload<{ include: typeof requestInclude }>

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
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
  const mine = searchParams.get("mine") === "1"
  const status = searchParams.get("status")
  const allowedStatuses = new Set(["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED", "CANCELLED"])
  const where: Prisma.MtmCustomerCreateRequestWhereInput = { organizationId: auth.orgId }

  if (mine) {
    if (!actor.agentId) return NextResponse.json({ success: true, data: { requests: [] } })
    where.requestedByAgentId = actor.agentId
  } else {
    if (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "SUPERVISOR") return forbidden()
    where.status = status && allowedStatuses.has(status)
      ? status as Prisma.EnumMtmApprovalStatusFilter["equals"]
      : { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] }
    if (actor.scopedAgentIds !== null) where.requestedByAgentId = { in: [...actor.scopedAgentIds] }
  }

  const requests = await prisma.mtmCustomerCreateRequest.findMany({
    where,
    include: requestInclude,
    orderBy: { updatedAt: "desc" },
    take: mine ? 50 : 200,
  })
  const candidates = requests.length > 0
    ? await prisma.mtmCustomer.findMany({
        where: { organizationId: auth.orgId, deletedAt: null },
        select: duplicateSelect,
        orderBy: { updatedAt: "desc" },
        take: 5000,
      })
    : []

  return NextResponse.json({
    success: true,
    data: {
      requests: requests.map((request: CustomerRequestListRow) => ({
        ...request,
        duplicateCandidates: rankMtmCustomerDuplicates(
          request,
          candidates.filter((candidate: MtmCustomerDuplicateRow) => candidate.id !== request.approvedCustomerId),
        ),
      })),
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor?.agentId) return forbidden()

  const parsed = parseBody(CustomerCreateRequestSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (body.routeId) {
    const route = await prisma.mtmRoute.findFirst({
      where: { id: body.routeId, organizationId: auth.orgId, deletedAt: null },
      include: { assignments: { where: { removedAt: null }, select: { agentId: true } } },
    })
    if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 })
    if (!canViewMtmRoute(actor, {
      primaryAgentId: route.agentId,
      assignedAgentIds: route.assignments.map((assignment: { agentId: string }) => assignment.agentId),
      status: route.status,
    })) return forbidden()
  }

  const [requester, customers] = await Promise.all([
    prisma.mtmAgent.findFirst({
      where: { id: actor.agentId, organizationId: auth.orgId },
      select: { id: true, name: true, managerId: true },
    }),
    prisma.mtmCustomer.findMany({
      where: { organizationId: auth.orgId, deletedAt: null },
      select: duplicateSelect,
      orderBy: { updatedAt: "desc" },
      take: 5000,
    }),
  ])
  if (!requester) return forbidden()

  const now = new Date()
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const request = await tx.mtmCustomerCreateRequest.create({
      data: {
        organizationId: auth.orgId,
        requestedByAgentId: requester.id,
        routeId: body.routeId ?? null,
        status: "SUBMITTED",
        objectType: body.objectType,
        externalCode: body.externalCode ?? null,
        name: body.name,
        address: body.address ?? null,
        city: body.city ?? null,
        district: body.district ?? null,
        ...normalizeMtmCoordinates(body),
        contactPerson: body.contactPerson ?? null,
        phone: body.phone ?? null,
        category: body.category ?? null,
        potential: body.potential,
        territoryCode: body.territoryCode ?? null,
        photoUrl: body.photoUrl ?? null,
        reason: body.reason,
        agentComment: body.agentComment ?? null,
        submittedAt: now,
      },
      include: requestInclude,
    })
    if (requester.managerId) {
      await enqueueMtmRouteNotification(tx, {
        organizationId: auth.orgId,
        agentId: requester.managerId,
        dedupeKey: `customer-create-request:${request.id}:manager-review:${requester.managerId}`,
        title: "New customer request needs review",
        body: `${requester.name} requested a new customer: ${body.name}`,
        type: "task",
        metadata: { requestId: request.id, routeId: body.routeId ?? null },
      })
    }
    return request
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: requester.id,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_CREATE_REQUEST,
    entity: "customer_create_request",
    entityId: created.id,
    metadataKind: "customer_create_request",
    newData: created,
    req,
  }).catch((error) => console.warn("[MTM/customer-create-requests POST] audit failed", error))

  return NextResponse.json({
    success: true,
    data: { ...created, duplicateCandidates: rankMtmCustomerDuplicates(body, customers) },
  }, { status: 201 })
})
