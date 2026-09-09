import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string }> }

const CLAIMABLE_STATUSES = ["initiated", "ringing"]

export const POST = withRlsAuth("inbox", "write", async (_req, auth, ctx: RouteCtx) => {
  const { id } = await ctx.params

  const call = await prisma.callLog.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      provider: true,
      status: true,
      claimedByUserId: true,
    },
  })
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 })
  if (call.provider !== "whatsapp") {
    return NextResponse.json({ error: "Only WhatsApp calls require operator claim" }, { status: 409 })
  }
  if (!CLAIMABLE_STATUSES.includes(call.status)) {
    return NextResponse.json({ error: "WhatsApp call is not waiting for an answer" }, { status: 409 })
  }
  if (call.claimedByUserId && call.claimedByUserId !== auth.userId) {
    return NextResponse.json({ error: "WhatsApp call is already claimed by another operator" }, { status: 409 })
  }

  const claimed = await prisma.callLog.updateMany({
    where: {
      id,
      organizationId: auth.orgId,
      provider: "whatsapp",
      status: { in: CLAIMABLE_STATUSES },
      OR: [
        { claimedByUserId: null },
        { claimedByUserId: auth.userId },
      ],
    },
    data: {
      claimedByUserId: auth.userId,
      claimedAt: new Date(),
    },
  })
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "WhatsApp call is already claimed by another operator" }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    data: { callLogId: id, claimedByUserId: auth.userId },
  })
})
