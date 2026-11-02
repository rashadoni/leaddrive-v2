import { z } from "zod"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"
import {
  MTM_LOCATION_REQUEST_CUSTOMER_MOVED,
  MTM_LOCATION_REQUEST_NOT_FOUND,
  customerPinStillAt,
  customerPinUnchangedSince,
} from "@/lib/mtm/customer-location-request"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"

type RouteContext = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(500).nullable().optional(),
  // «Подтвердить» on a request whose pin was moved after the agent asked:
  // the manager was shown that and said yes (owner, 2026-10-16: «тут должно
  // быть либо подтверждаю, либо отклоняю»). Without it such an answer is 409,
  // so a tab that never showed the warning cannot move the pin a second time.
  confirmPinMoved: z.boolean().optional(),
})

class ConcurrentDecisionError extends Error {}
/** The customer's pin is not where it stood when the agent asked. */
class CustomerMovedError extends Error {}

/**
 * POST /api/v1/mtm/customer-location-requests/:id/decision
 *
 * A manager's answer to «Клиент здесь». `APPROVED` moves the customer's pin
 * to the place the agent reported — in the same transaction as the answer,
 * and only if the pin still stands where it stood when the agent asked — and
 * leaves a coordinate-verification receipt naming the agent's fix as its
 * source; the visits the agent checked in from that place while the request
 * waited are from then on measured against it. `REJECTED` leaves the customer
 * as it is, and those visits as they were recorded: outside the zone. Either way the agent is
 * told, and the journal keeps who decided and what the pin was and became.
 */
export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }
  const body = parsed.data
  const comment = body.comment || null

  const request = await prisma.mtmCustomerLocationRequest.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { customer: { select: { id: true, name: true } } },
  })
  if (!request) return NextResponse.json({ error: "Not found", code: MTM_LOCATION_REQUEST_NOT_FOUND }, { status: 404 })
  // Nobody answers his own question, and nobody answers for agents he does not answer for.
  if (!canReviewMtmRouteRequest(actor, request.requestedByAgentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }
  if (request.status !== "SUBMITTED") {
    if (request.status === body.decision) {
      return NextResponse.json({ success: true, data: { id, status: request.status, reviewedAt: request.reviewedAt }, idempotent: true })
    }
    return NextResponse.json({ error: "Request already decided", code: "APPROVAL_ALREADY_DECIDED", status: request.status }, { status: 409 })
  }

  const now = new Date()
  // Where the pin stood when it was moved: what the agent saw, or — confirmed
  // over a later change — where somebody had put it since. For the journal.
  let replaced = { latitude: request.previousLatitude, longitude: request.previousLongitude }
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.mtmCustomerLocationRequest.updateMany({
        where: { id, organizationId: auth.orgId, status: "SUBMITTED" },
        data: { status: body.decision, reviewedBy: auth.userId, decisionComment: comment, reviewedAt: now },
      })
      if (claimed.count !== 1) throw new ConcurrentDecisionError("Request changed concurrently")

      if (body.decision === "APPROVED") {
        const customer = await tx.mtmCustomer.findFirst({
          where: { id: request.customerId, organizationId: auth.orgId, deletedAt: null },
          select: { latitude: true, longitude: true },
        })
        if (!customer) throw new CustomerMovedError("Customer gone")
        const unchanged = customerPinUnchangedSince(request, customer)
        if (!unchanged && !body.confirmPinMoved) throw new CustomerMovedError("Customer pin changed")
        if (!unchanged) {
          const current = normalizeMtmCoordinates(customer)
          replaced = { latitude: current.latitude, longitude: current.longitude }
        }
        // From the place this answer was given against, and no other: a pin
        // moved a moment ago by somebody else is not moved again.
        const moved = await tx.mtmCustomer.updateMany({
          where: {
            id: request.customerId,
            organizationId: auth.orgId,
            deletedAt: null,
            ...customerPinStillAt({ previousLatitude: replaced.latitude, previousLongitude: replaced.longitude }),
          },
          data: { latitude: request.proposedLatitude, longitude: request.proposedLongitude },
        })
        if (moved.count !== 1) throw new CustomerMovedError("Customer pin changed")
        // The visits this agent checked in from the reported place while the
        // request waited were measured against the old pin («вне зоны»). The
        // place is now the customer's: they were made at the customer.
        await tx.mtmVisit.updateMany({
          where: { organizationId: auth.orgId, locationRequestId: id },
          data: { checkInCustomerLat: request.proposedLatitude, checkInCustomerLng: request.proposedLongitude },
        })
        // The organization card shows where its coordinates come from: now from a person who stood there.
        await tx.mtmCustomerCoordinateVerification.create({
          data: {
            organizationId: auth.orgId,
            customerId: request.customerId,
            latitude: request.proposedLatitude,
            longitude: request.proposedLongitude,
            status: "VERIFIED",
            accuracyMeters: request.agentAccuracyMeters,
            sourceSystem: "FIELD_AGENT",
            sourceReference: `customer-location-request:${request.id}`,
            sourceObservedAt: request.agentFixAt,
            decisionReason: comment,
            verifiedByUserId: auth.userId,
          },
        })
      }

      await enqueueMtmRouteNotification(tx, {
        organizationId: auth.orgId,
        agentId: request.requestedByAgentId,
        dedupeKey: `customer-location-request:${id}:decision:${body.decision}`,
        title: body.decision === "APPROVED" ? "Customer location corrected" : "Customer location request declined",
        body: body.decision === "APPROVED"
          ? `${request.customer.name}: the pin now stands where you reported.`
          : comment ? `${request.customer.name}: ${comment}` : `${request.customer.name}: the pin stays where it was.`,
        type: body.decision === "APPROVED" ? "info" : "task",
        metadata: { kind: "customer_location_request_decision", requestId: id, customerId: request.customerId, decision: body.decision },
      })
    })
  } catch (error) {
    if (error instanceof CustomerMovedError) {
      return NextResponse.json({
        error: "The customer's pin was moved after the agent asked",
        code: MTM_LOCATION_REQUEST_CUSTOMER_MOVED,
      }, { status: 409 })
    }
    if (error instanceof ConcurrentDecisionError) {
      const current = await prisma.mtmCustomerLocationRequest.findFirst({
        where: { id, organizationId: auth.orgId },
        select: { status: true, reviewedAt: true },
      })
      if (current?.status === body.decision) {
        return NextResponse.json({ success: true, data: { id, status: current.status, reviewedAt: current.reviewedAt }, idempotent: true })
      }
      return NextResponse.json({ error: "Request changed concurrently", code: "APPROVAL_CONFLICT" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: request.requestedByAgentId,
    action: MTM_ROUTE_AUDIT_ACTION.CUSTOMER_LOCATION_DECISION,
    entity: "customer_location_request",
    entityId: id,
    metadataKind: "customer_location_decision",
    oldData: { status: "SUBMITTED", latitude: replaced.latitude, longitude: replaced.longitude },
    newData: {
      status: body.decision,
      customerId: request.customerId,
      latitude: body.decision === "APPROVED" ? request.proposedLatitude : request.previousLatitude,
      longitude: body.decision === "APPROVED" ? request.proposedLongitude : request.previousLongitude,
      comment,
      ...(body.decision === "APPROVED" && body.confirmPinMoved && (replaced.latitude !== request.previousLatitude || replaced.longitude !== request.previousLongitude)
        ? { confirmedOverPinMovedSinceRequest: true, pinWhenAgentAsked: { latitude: request.previousLatitude, longitude: request.previousLongitude } }
        : {}),
    },
    req,
  }).catch((error) => console.warn("[MTM/customer-location-requests/decision] audit failed", error))

  return NextResponse.json({ success: true, data: { id, status: body.decision, reviewedAt: now } })
})
