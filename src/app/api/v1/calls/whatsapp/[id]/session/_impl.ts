import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  getWhatsAppCallSession,
  isWhatsAppCallSessionStoreReady,
  type WhatsAppCallSession,
} from "@/lib/whatsapp-call-sessions"

type RouteCtx = { params: Promise<{ id: string }> }

export type WhatsAppCallSessionLoader = (
  organizationId: string,
  callId: string,
) => Promise<WhatsAppCallSession | null>

export async function getWhatsAppCallSessionRoute(
  _req: NextRequest,
  auth: AuthResult,
  ctx: RouteCtx,
  loadSession: WhatsAppCallSessionLoader = getWhatsAppCallSession,
) {
  const { id } = await ctx.params
  const call = await prisma.callLog.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      callSid: true,
      provider: true,
    },
  })
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 })
  if (call.provider !== "whatsapp" || !call.callSid) {
    return NextResponse.json({ error: "This session is only available for WhatsApp calls" }, { status: 409 })
  }
  if (!isWhatsAppCallSessionStoreReady()) {
    return NextResponse.json({ error: "WhatsApp call session store is not ready. Configure REDIS_URL before answering live calls." }, { status: 503 })
  }

  const session = await loadSession(auth.orgId, call.callSid)
  if (!session) {
    return NextResponse.json({ error: "WhatsApp call session expired or not available" }, { status: 404 })
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        callLogId: call.id,
        callSid: call.callSid,
        sdp: session.sdp,
        sdpType: session.sdpType,
        direction: session.direction,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber,
        conversationId: session.conversationId,
        expiresAt: session.expiresAt,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
