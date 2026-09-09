import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { BROWSER_LEAD_CALL_CLAIM_LEASE_MS } from "@/lib/voip/browser-lead-claim"

type RouteCtx = { params: Promise<{ id: string }> }

function readToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const token = (body as { token?: unknown }).token
  return typeof token === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
    ? token
    : null
}

async function ownedActiveBrowserLeadCall(
  id: string,
  organizationId: string,
  userId: string,
) {
  return prisma.callLog.findFirst({
    where: {
      id,
      organizationId,
      userId,
      direction: "outbound",
      callMode: "human",
      leadId: { not: null },
      leadCallClaimToken: { not: null },
      endedAt: null,
    },
    select: {
      leadId: true,
      leadCallClaimToken: true,
    },
  })
}

// PATCH — extend one browser's still-live lease. The token is a compare-and-
// set guard, so an old tab can never renew a claim acquired after its expiry.
export const PATCH = withRlsAuth("voip", "write", async (req, auth, ctx: RouteCtx) => {
  const { id } = await ctx.params
  const token = readToken(await req.json().catch(() => null))
  if (!token) return NextResponse.json({ error: "invalid_lead_call_claim" }, { status: 400 })

  const call = await ownedActiveBrowserLeadCall(id, auth.orgId, auth.userId)
  if (!call?.leadId || call.leadCallClaimToken !== token) {
    return NextResponse.json({ error: "lead_call_claim_lost" }, { status: 409 })
  }

  const now = new Date()
  const renewed = await prisma.lead.updateMany({
    where: {
      id: call.leadId,
      organizationId: auth.orgId,
      browserCallClaimToken: token,
      browserCallClaimedByUserId: auth.userId,
      browserCallClaimExpiresAt: { gt: now },
    },
    data: {
      browserCallClaimExpiresAt: new Date(now.getTime() + BROWSER_LEAD_CALL_CLAIM_LEASE_MS),
    },
  })
  if (renewed.count !== 1) {
    return NextResponse.json({ error: "lead_call_claim_lost" }, { status: 409 })
  }

  return NextResponse.json({ success: true })
})
