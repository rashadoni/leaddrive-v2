import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mutableVisitWhere } from "@/lib/mtm/visit-scope"

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })

  const visits = await prisma.mtmVisit.findMany({
    // The resume workspace performs generic checkout/result mutations. Keep
    // this list in the same primary-agent mutation scope as those endpoints;
    // participation alone is a read/attribution capability.
    where: mutableVisitWhere(actor, auth.orgId, { status: "CHECKED_IN" }),
    orderBy: { checkInAt: "desc" },
    take: 50,
    select: {
      id: true,
      agentId: true,
      customerId: true,
      routeId: true,
      routePointId: true,
      checkInAt: true,
      agent: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, address: true } },
      requirementSnapshot: {
        select: { requirements: { where: { mode: "REQUIRED" }, select: { actionKey: true, minCount: true } } },
      },
    },
  })
  return NextResponse.json({ success: true, data: { visits } })
})
