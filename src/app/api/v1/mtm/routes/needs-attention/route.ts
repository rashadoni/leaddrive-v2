import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

const OPEN_APPROVAL_STATUSES: ("SUBMITTED" | "IN_REVIEW" | "NEEDS_INFO")[] = ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"]

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
}

/**
 * A deliberately aggregate-only companion to the approval queues.
 * It uses their exact organization and manager scope rules, without returning
 * customer, route, or request data before the reviewer opens the relevant queue.
 */
export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })

  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "SUPERVISOR")) {
    return forbidden()
  }

  const routeChanges: Prisma.MtmRouteChangeRequestWhereInput = {
    organizationId: auth.orgId,
    status: { in: OPEN_APPROVAL_STATUSES },
  }
  const customerRequests: Prisma.MtmCustomerCreateRequestWhereInput = {
    organizationId: auth.orgId,
    status: { in: OPEN_APPROVAL_STATUSES },
  }
  // «Клиент здесь»: requests to move a customer's pin, sent from the spot.
  const customerLocationRequests: Prisma.MtmCustomerLocationRequestWhereInput = {
    organizationId: auth.orgId,
    status: "SUBMITTED",
  }

  if (actor.scopedAgentIds !== null) {
    const scopedAgentIds = [...actor.scopedAgentIds]
    routeChanges.OR = [
      { requestedByAgentId: { in: scopedAgentIds } },
      { route: { agentId: { in: scopedAgentIds } } },
    ]
    customerRequests.requestedByAgentId = { in: scopedAgentIds }
    customerLocationRequests.requestedByAgentId = { in: scopedAgentIds }
  }

  const [routeChangeCount, customerRequestCount, customerLocationRequestCount] = await Promise.all([
    prisma.mtmRouteChangeRequest.count({ where: routeChanges }),
    prisma.mtmCustomerCreateRequest.count({ where: customerRequests }),
    prisma.mtmCustomerLocationRequest.count({ where: customerLocationRequests }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      schemaVersion: 1,
      total: routeChangeCount + customerRequestCount + customerLocationRequestCount,
      categories: {
        routeChanges: { count: routeChangeCount },
        customerRequests: { count: customerRequestCount },
        customerLocationRequests: { count: customerLocationRequestCount },
      },
    },
  })
})
