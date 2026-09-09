import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { CustomerCreateRequestUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

export const PATCH = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor?.agentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = parseBody(CustomerCreateRequestUpdateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const before = await prisma.mtmCustomerCreateRequest.findFirst({
    where: { id, organizationId: auth.orgId, requestedByAgentId: actor.agentId },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (before.status !== "NEEDS_INFO") {
    return NextResponse.json({ error: "Only requests needing information can be resubmitted", code: "REQUEST_TRANSITION_INVALID" }, { status: 409 })
  }

  const data: Prisma.MtmCustomerCreateRequestUpdateManyMutationInput = {
    status: "SUBMITTED",
    submittedAt: new Date(),
    agentComment: body.agentComment,
  }
  for (const key of [
    "objectType", "externalCode", "name", "address", "city", "district",
    "contactPerson", "phone", "category", "potential", "territoryCode", "photoUrl", "reason",
  ] as const) {
    if (body[key] !== undefined) Object.assign(data, { [key]: body[key] })
  }
  if (body.latitude !== undefined || body.longitude !== undefined) Object.assign(data, normalizeMtmCoordinates(body))

  const requester = await prisma.mtmAgent.findFirst({
    where: { id: actor.agentId, organizationId: auth.orgId },
    select: { name: true, managerId: true },
  })
  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const changed = await tx.mtmCustomerCreateRequest.updateMany({
      where: { id, organizationId: auth.orgId, requestedByAgentId: actor.agentId!, status: "NEEDS_INFO" },
      data,
    })
    if (changed.count !== 1) throw new Error("Request changed concurrently")
    if (requester?.managerId) {
      await enqueueMtmRouteNotification(tx, {
        organizationId: auth.orgId,
        agentId: requester.managerId,
        dedupeKey: `customer-create-request:${id}:resubmission:${before.updatedAt.toISOString()}:${requester.managerId}`,
        title: "Customer request resubmitted",
        body: `${requester.name} added the requested information.`,
        type: "task",
        metadata: { requestId: id },
      })
    }
    return tx.mtmCustomerCreateRequest.findUnique({ where: { id } })
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_CREATE_REQUEST,
    entity: "customer_create_request",
    entityId: id,
    metadataKind: "customer_create_resubmission",
    oldData: { status: before.status, agentComment: before.agentComment },
    newData: { status: "SUBMITTED", agentComment: body.agentComment },
    req,
  }).catch((error) => console.warn("[MTM/customer-create-requests PATCH] audit failed", error))

  return NextResponse.json({ success: true, data: updated })
})
