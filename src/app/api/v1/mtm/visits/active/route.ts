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

  const select = {
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
  } as const
  const [scoped, ownRows] = await Promise.all([
    prisma.mtmVisit.findMany({
      // The resume workspace performs generic checkout/result mutations. Keep
      // this list in the same primary-agent mutation scope as those endpoints;
      // participation alone is a read/attribution capability.
      where: mutableVisitWhere(actor, auth.orgId, { status: "CHECKED_IN" }),
      orderBy: { checkInAt: "desc" },
      take: 50,
      select,
    }),
    // The viewer's own open visit must survive the cap above: a manager or
    // admin who is also an agent would otherwise lose their workspace behind
    // fifty newer team visits. AND keeps the mutation scope intact.
    actor.agentId
      ? prisma.mtmVisit.findMany({
        where: mutableVisitWhere(actor, auth.orgId, { status: "CHECKED_IN", AND: [{ agentId: actor.agentId }] }),
        orderBy: { checkInAt: "desc" },
        take: 5,
        select,
      })
      : null,
  ])
  const own: typeof scoped = ownRows ?? []
  const ownIds = new Set(own.map((visit: { id: string }) => visit.id))
  const visits = [...own, ...scoped.filter((visit: { id: string }) => !ownIds.has(visit.id))]
  return NextResponse.json({
    success: true,
    data: {
      visits,
      // The page shows the execution workspace only for the viewer's own
      // visits; everyone else gets the read-only review.
      viewer: { agentId: actor.agentId, role: actor.role },
    },
  })
})
