import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { readMtmRouteChangeEvidence } from "@/lib/mtm/route-change-evidence"

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "SUPERVISOR")) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const where: Record<string, unknown> = {
    organizationId: auth.orgId,
    status: status || { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
  }
  if (actor.scopedAgentIds !== null) {
    where.OR = [
      { requestedByAgentId: { in: [...actor.scopedAgentIds] } },
      { route: { agentId: { in: [...actor.scopedAgentIds] } } },
    ]
  }

  const requests = await prisma.mtmRouteChangeRequest.findMany({
    where,
    orderBy: { submittedAt: "asc" },
    include: {
      requestedByAgent: { select: { id: true, name: true } },
      route: { select: { id: true, name: true, date: true, status: true, agentId: true } },
      routePoint: { include: { customer: { select: { id: true, name: true } } } },
    },
  })
  // Additive projection: existing clients retain `payload`, while new clients
  // get a clear evidence contract and can label pre-R5 records honestly.
  const requestsWithEvidence = requests.map((request) => ({
    ...request,
    ...readMtmRouteChangeEvidence(request.payload),
  }))
  return NextResponse.json({ success: true, data: { requests: requestsWithEvidence } })
})
