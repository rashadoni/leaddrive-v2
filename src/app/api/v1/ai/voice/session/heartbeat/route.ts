import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"

/**
 * Keep-alive from the console. Its absence — not its presence — is what the
 * reaper acts on: a tab that dies mid-conversation stops beating, and the
 * session is then settled at its full reservation rather than at zero.
 */
export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  const body = await req.json().catch(() => null)
  const voiceSessionId = (body as { voiceSessionId?: unknown } | null)?.voiceSessionId
  if (typeof voiceSessionId !== "string" || !voiceSessionId) {
    return NextResponse.json({ error: "voiceSessionId required" }, { status: 400 })
  }

  // Scoped by org AND user: a pilot user must not be able to keep someone
  // else's session alive, which would also keep charging them.
  const updated = await prisma.voiceSession.updateMany({
    where: voiceScopedWhere(auth.orgId, {
      id: voiceSessionId,
      userId: auth.userId,
      status: "active",
    }),
    data: { lastHeartbeatAt: new Date() },
  })

  if (updated.count !== 1) {
    // Already ended or reaped — tell the client so it stops beating and closes.
    return NextResponse.json({ error: "Session is not active" }, { status: 409 })
  }

  return NextResponse.json({ data: { ok: true } })
})
