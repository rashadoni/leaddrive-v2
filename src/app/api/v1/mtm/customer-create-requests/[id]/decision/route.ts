import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { CustomerCreateRequestDecisionSchema, parseBody } from "@/lib/mtm-validators"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { rankMtmCustomerDuplicates } from "@/lib/mtm/customer-request"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

type RouteContext = { params: Promise<{ id: string }> }

class ConcurrentDecisionError extends Error {}
class DuplicateCustomerError extends Error {
  constructor(readonly candidates: ReturnType<typeof rankMtmCustomerDuplicates>) {
    super("A matching customer already exists")
  }
}

const duplicateSelect = {
  id: true,
  code: true,
  name: true,
  phone: true,
  address: true,
  latitude: true,
  longitude: true,
} as const

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = parseBody(CustomerCreateRequestDecisionSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const request = await prisma.mtmCustomerCreateRequest.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { approvedCustomer: { select: { id: true, code: true, name: true } } },
  })
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canReviewMtmRouteRequest(actor, request.requestedByAgentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }

  if (["APPROVED", "REJECTED", "CANCELLED"].includes(request.status)) {
    if (request.status === body.decision) {
      return NextResponse.json({ success: true, data: request, idempotent: true })
    }
    return NextResponse.json({ error: "Request already decided", code: "APPROVAL_ALREADY_DECIDED" }, { status: 409 })
  }

  const now = new Date()
  let approvedCustomer: { id: string; code: string | null; name: string } | null = null
  try {
    if (body.decision === "APPROVED") {
      approvedCustomer = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const claimed = await tx.mtmCustomerCreateRequest.updateMany({
          where: {
            id,
            organizationId: auth.orgId,
            status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
            approvedCustomerId: null,
          },
          data: { status: "IN_REVIEW", reviewedBy: auth.userId, decisionComment: body.comment ?? null },
        })
        if (claimed.count !== 1) throw new ConcurrentDecisionError("Request changed concurrently")

        const customerPool = await tx.mtmCustomer.findMany({
          where: { organizationId: auth.orgId, deletedAt: null },
          select: duplicateSelect,
          orderBy: { updatedAt: "desc" },
          take: 5000,
        })
        const duplicateCandidates = rankMtmCustomerDuplicates(request, customerPool)
        const exactCandidates = duplicateCandidates.filter((candidate) => candidate.exact)
        if (exactCandidates.length > 0) throw new DuplicateCustomerError(exactCandidates)

        const customer = await tx.mtmCustomer.create({
          data: {
            organizationId: auth.orgId,
            code: request.externalCode,
            name: request.name,
            objectType: request.objectType,
            category: request.category ?? "B",
            status: "ACTIVE",
            address: request.address,
            city: request.city,
            district: request.district,
            // Requests approved before the 2026-09 backfill may still carry 0,0.
            ...normalizeMtmCoordinates(request),
            phone: request.phone,
            contactPerson: request.contactPerson,
            notes: request.agentComment,
          },
          select: { id: true, code: true, name: true },
        })
        await tx.mtmCustomerCreateRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            approvedCustomerId: customer.id,
            reviewedBy: auth.userId,
            decisionComment: body.comment ?? null,
            reviewedAt: now,
          },
        })
        await enqueueMtmRouteNotification(tx, {
          organizationId: auth.orgId,
          agentId: request.requestedByAgentId,
          dedupeKey: `customer-create-request:${id}:decision:${request.updatedAt.toISOString()}:APPROVED:${request.requestedByAgentId}`,
          title: "New customer request approved",
          body: `${customer.name} is ready to use.`,
          type: "info",
          metadata: { requestId: id, customerId: customer.id, routeId: request.routeId },
        })
        return customer
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } else {
      const changed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.mtmCustomerCreateRequest.updateMany({
          where: { id, organizationId: auth.orgId, status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] } },
          data: {
            status: body.decision,
            reviewedBy: auth.userId,
            decisionComment: body.comment,
            reviewedAt: now,
          },
        })
        if (updated.count !== 1) throw new ConcurrentDecisionError("Request changed concurrently")
        await enqueueMtmRouteNotification(tx, {
          organizationId: auth.orgId,
          agentId: request.requestedByAgentId,
          dedupeKey: `customer-create-request:${id}:decision:${request.updatedAt.toISOString()}:${body.decision}:${request.requestedByAgentId}`,
          title: body.decision === "REJECTED" ? "New customer request rejected" : "Customer request needs information",
          body: body.comment,
          type: "task",
          metadata: { requestId: id, decision: body.decision },
        })
        return updated
      })
      if (changed.count !== 1) throw new ConcurrentDecisionError("Request changed concurrently")
    }
  } catch (error) {
    if (error instanceof DuplicateCustomerError) {
      return NextResponse.json({
        error: error.message,
        code: "CUSTOMER_DUPLICATE",
        duplicateCandidates: error.candidates,
      }, { status: 409 })
    }
    if (error instanceof ConcurrentDecisionError) {
      const current = await prisma.mtmCustomerCreateRequest.findFirst({
        where: { id, organizationId: auth.orgId },
        include: { approvedCustomer: { select: { id: true, code: true, name: true } } },
      })
      if (current?.status === body.decision) {
        return NextResponse.json({ success: true, data: current, idempotent: true })
      }
      return NextResponse.json({ error: "Request changed concurrently", code: "APPROVAL_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A customer with this code already exists", code: "CUSTOMER_DUPLICATE" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: request.requestedByAgentId,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_CREATE_DECISION,
    entity: "customer_create_request",
    entityId: id,
    metadataKind: "customer_create_decision",
    oldData: { status: request.status },
    newData: { status: body.decision, approvedCustomerId: approvedCustomer?.id ?? null, comment: body.comment ?? null },
    req,
  }).catch((error) => console.warn("[MTM/customer-create-requests/decision] audit failed", error))

  return NextResponse.json({
    success: true,
    data: { id, status: body.decision, approvedCustomer, reviewedAt: now },
  })
})
