import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { readWorkingHours } from "@/lib/mtm/customer-hours"
import { placeHoursUnchangedSince } from "@/lib/mtm/customer-hours-request"

const requestInclude = {
  requestedByAgent: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, address: true, city: true, workingHours: true } },
} satisfies Prisma.MtmCustomerHoursRequestInclude

type HoursRequestRow = Prisma.MtmCustomerHoursRequestGetPayload<{ include: typeof requestInclude }>

const WAITING_LIMIT = 200
const ANSWERED_LIMIT = 30

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

function project(row: HoursRequestRow, canDecide: boolean) {
  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    comment: row.comment,
    decisionComment: row.decisionComment,
    agent: row.requestedByAgent,
    customer: { id: row.customer.id, name: row.customer.name, address: row.customer.address, city: row.customer.city },
    previousHours: readWorkingHours(row.previousHours),
    proposedHours: readWorkingHours(row.proposedHours),
    currentHours: readWorkingHours(row.customer.workingHours),
    // Somebody changed the hours after the agent asked: the screen says so before «Принять».
    hoursChangedSince: row.status === "SUBMITTED" && !placeHoursUnchangedSince(row.previousHours, row.customer.workingHours),
    canDecide,
  }
}

/**
 * GET /api/v1/mtm/customer-hours-requests
 *
 * «Часы не те?»: what agents sent from the spot about places whose «часы
 * приёма» are wrong — for the people who decide (administrator, manager,
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
  const where: Prisma.MtmCustomerHoursRequestWhereInput = {
    organizationId: auth.orgId,
    status: answered ? { in: ["APPROVED", "REJECTED"] } : "SUBMITTED",
  }
  if (actor.scopedAgentIds !== null) where.requestedByAgentId = { in: [...actor.scopedAgentIds] }

  const requests = await prisma.mtmCustomerHoursRequest.findMany({
    where,
    include: requestInclude,
    orderBy: answered ? { reviewedAt: "desc" } : { submittedAt: "asc" },
    take: answered ? ANSWERED_LIMIT : WAITING_LIMIT,
  })

  return NextResponse.json({
    success: true,
    data: { requests: requests.map((request) => project(request, canReviewMtmRouteRequest(actor, request.requestedByAgentId))) },
  }, { headers: { "Cache-Control": "no-store" } })
})
