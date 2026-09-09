import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { settleVoiceSeconds } from "@/lib/ai/voice/budget"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"
import { MAX_SESSION_SECONDS } from "@/lib/ai/voice/config"
import { voiceMarkerIsPreConnection } from "@/lib/ai/voice/session-marker"

/**
 * Confirmed end of a conversation: close the row and hand back the unused part
 * of the reservation.
 *
 * The close is a single guarded UPDATE off `status: "active"`, so a double
 * "end" (user clicks stop as the reaper fires) cannot refund twice.
 */
export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  const body = await req.json().catch(() => null)
  const { voiceSessionId, elapsedSeconds } = (body ?? {}) as {
    voiceSessionId?: unknown
    elapsedSeconds?: unknown
  }
  if (typeof voiceSessionId !== "string" || !voiceSessionId) {
    return NextResponse.json({ error: "voiceSessionId required" }, { status: 400 })
  }

  // null -> minting -> issued -> connected may race with stop. Four bounded
  // exact-marker CAS attempts classify the state that actually won.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const session = await prisma.voiceSession.findFirst({
      where: voiceScopedWhere(auth.orgId, { id: voiceSessionId, userId: auth.userId }),
      select: {
        id: true,
        status: true,
        reservedSeconds: true,
        startedAt: true,
        elevenlabsConversationId: true,
      },
    })
    if (!session) {
      if (attempt === 0) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 })
      }
      return NextResponse.json({ data: { alreadyClosed: true } })
    }
    if (session.status !== "active") {
      return NextResponse.json({ data: { alreadyClosed: true } })
    }

    const now = new Date()
    const marker = session.elevenlabsConversationId
    // Provider-neutral so a session that was in flight during a provider
    // migration still settles conservatively.
    const isPreConnection = voiceMarkerIsPreConnection(marker)
    const wallClock = Math.ceil((now.getTime() - session.startedAt.getTime()) / 1000)
    const clientClaim = typeof elapsedSeconds === "number" && elapsedSeconds >= 0 ? elapsedSeconds : 0
    const connectedBilled = Math.min(
      session.reservedSeconds || MAX_SESSION_SECONDS,
      Math.max(wallClock, clientClaim),
    )
    const billed = isPreConnection ? 0 : connectedBilled
    const terminalStatus = isPreConnection ? "never_connected" : "ended"

    const closed = await prisma.voiceSession.updateMany({
      where: voiceScopedWhere(auth.orgId, {
        id: voiceSessionId,
        userId: auth.userId,
        status: "active",
        elevenlabsConversationId: marker,
      }),
      data: { status: terminalStatus, endedAt: now, billedSeconds: billed },
    })
    if (closed.count !== 1) continue

    // Settle the same month in which the reservation was made. This matters
    // for a session that crosses a month boundary by a few minutes.
    await settleVoiceSeconds(auth.orgId, auth.userId, session.reservedSeconds, billed, session.startedAt)

    await logAudit(auth.orgId, "voice_session_ended", "voice_session", session.id, undefined, {
      userId: auth.userId,
      newValue: { billedSeconds: billed, status: terminalStatus },
    })

    return NextResponse.json({ data: { billedSeconds: billed } })
  }

  return NextResponse.json({ data: { alreadyClosed: true } })
})
