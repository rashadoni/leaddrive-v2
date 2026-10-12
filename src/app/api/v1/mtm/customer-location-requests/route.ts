import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { customerPinUnchangedSince } from "@/lib/mtm/customer-location-request"

const requestInclude = {
  requestedByAgent: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, address: true, city: true, latitude: true, longitude: true } },
  // Visits the agent has already checked in from the place he reported.
  visits: {
    where: { deletedAt: null },
    orderBy: { checkInAt: "asc" },
    take: 5,
    select: { id: true, checkInAt: true },
  },
} satisfies Prisma.MtmCustomerLocationRequestInclude

type LocationRequestRow = Prisma.MtmCustomerLocationRequestGetPayload<{ include: typeof requestInclude }>

/** How far back «визиты вне зоны по этому клиенту» looks: evidence that the pin has been wrong for a while. */
const OUT_OF_ZONE_EVIDENCE_DAYS = 90
const WAITING_LIMIT = 200
const ANSWERED_LIMIT = 30

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function project(row: LocationRequestRow, outOfZoneAlerts: number, canDecide: boolean) {
  const pin = normalizeMtmCoordinates(row.customer)
  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    comment: row.comment,
    decisionComment: row.decisionComment,
    agent: row.requestedByAgent,
    customer: { id: row.customer.id, name: row.customer.name, address: row.customer.address, city: row.customer.city, ...pin },
    previous: row.previousLatitude === null || row.previousLongitude === null
      ? null
      : { latitude: row.previousLatitude, longitude: row.previousLongitude },
    proposed: { latitude: row.proposedLatitude, longitude: row.proposedLongitude },
    agentFix: {
      latitude: row.agentLatitude,
      longitude: row.agentLongitude,
      accuracyMeters: Math.round(row.agentAccuracyMeters),
      at: row.agentFixAt,
    },
    movedMeters: row.movedMeters,
    agentToProposedMeters: row.agentToProposedMeters,
    // «Адрес на проверке»: accepted from the reported place, and outside the zone until this is accepted.
    visits: row.visits.map((visit) => ({ id: visit.id, checkInAt: visit.checkInAt })),
    // Somebody moved the pin after the agent asked: accepting would be refused, and the screen says why.
    pinMovedSince: row.status === "SUBMITTED" && !customerPinUnchangedSince(row, row.customer),
    outOfZoneAlerts,
    canDecide,
  }
}

/**
 * GET /api/v1/mtm/customer-location-requests
 *
 * «Клиент здесь»: what agents sent from the spot about customers whose pin is
 * in the wrong place — for the people who decide (administrator, manager,
 * supervisor), each within the agents they answer for. Waiting ones by
 * default; `?status=answered` — the latest that were accepted or declined.
 */
export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return forbidden()
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "SUPERVISOR") return forbidden()

  const answered = new URL(req.url).searchParams.get("status") === "answered"
  const where: Prisma.MtmCustomerLocationRequestWhereInput = {
    organizationId: auth.orgId,
    status: answered ? { in: ["APPROVED", "REJECTED"] } : "SUBMITTED",
  }
  if (actor.scopedAgentIds !== null) where.requestedByAgentId = { in: [...actor.scopedAgentIds] }

  const requests = await prisma.mtmCustomerLocationRequest.findMany({
    where,
    include: requestInclude,
    orderBy: answered ? { reviewedAt: "desc" } : { submittedAt: "asc" },
    take: answered ? ANSWERED_LIMIT : WAITING_LIMIT,
  })

  // «Вне зоны» alerts name their customer in `metadata.customerId`.
  const counts = new Map<string, number>()
  const customerIds = [...new Set(requests.map((request) => request.customerId))]
  if (!answered && customerIds.length > 0) {
    const since = new Date(Date.now() - OUT_OF_ZONE_EVIDENCE_DAYS * 24 * 60 * 60 * 1000)
    const alerts = await prisma.mtmAlert.findMany({
      where: {
        organizationId: auth.orgId,
        type: "OUT_OF_ZONE",
        createdAt: { gte: since },
        OR: customerIds.map((customerId) => ({ metadata: { path: ["customerId"], equals: customerId } })),
      },
      select: { metadata: true },
      take: 5000,
    })
    for (const alert of alerts) {
      const customerId = (alert.metadata as { customerId?: unknown } | null)?.customerId
      if (typeof customerId === "string") counts.set(customerId, (counts.get(customerId) ?? 0) + 1)
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      requests: requests.map((request) => project(
        request,
        counts.get(request.customerId) ?? 0,
        canReviewMtmRouteRequest(actor, request.requestedByAgentId),
      )),
      outOfZoneEvidenceDays: OUT_OF_ZONE_EVIDENCE_DAYS,
    },
  }, { headers: { "Cache-Control": "no-store" } })
})
