import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const requests = await prisma.mtmContactCreateRequest.findMany({
    where: {
      organizationId: auth.orgId,
      status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
      ...(actor.scopedAgentIds === null ? {} : { requestedByAgentId: { in: [...actor.scopedAgentIds] } }),
    },
    include: { requestedByAgent: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "asc" },
    take: 200,
  })
  return NextResponse.json({ success: true, data: { requests } })
})
