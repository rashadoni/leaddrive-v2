import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { pharmacyPromotionSyncScopeKey } from "@/lib/mtm/pharmacy-promotion"

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({
      error: "MTM agent is inactive",
      code: "MTM_AGENT_INACTIVE",
    }, { status: 403 })
  }

  return NextResponse.json({
    success: true,
    data: {
      scopeKey: pharmacyPromotionSyncScopeKey({
        organizationId: auth.orgId,
        userId: auth.userId,
        agentId: actor.agentId,
      }),
      canFieldExecute: actor.role === "AGENT" && Boolean(actor.agentId),
    },
  })
})
