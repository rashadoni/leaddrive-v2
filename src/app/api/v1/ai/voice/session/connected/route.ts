import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { geminiVoiceMarker } from "@/lib/ai/voice/session-marker"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"

const bodySchema = z.object({
  voiceSessionId: z.string().min(6).max(64),
  connectionId: z.string().uuid(),
}).strict()

/** Confirm billing start only after Gemini Live setupComplete. */
export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard
  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const issued = geminiVoiceMarker("issued", parsed.data.connectionId)
  const connected = geminiVoiceMarker("connected", parsed.data.connectionId)
  const updated = await prisma.voiceSession.updateMany({
    where: {
      id: parsed.data.voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      expiresAt: { gt: new Date() },
      elevenlabsConversationId: issued,
    },
    data: { elevenlabsConversationId: connected },
  })
  if (updated.count === 1) {
    return NextResponse.json({ data: { connected: true } }, { headers: { "Cache-Control": "no-store" } })
  }
  const replay = await prisma.voiceSession.findFirst({
    where: {
      id: parsed.data.voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      elevenlabsConversationId: connected,
    },
    select: { id: true },
  })
  if (replay) {
    return NextResponse.json({ data: { connected: true, replay: true } }, { headers: { "Cache-Control": "no-store" } })
  }
  return NextResponse.json({ error: "Session is no longer connectable" }, { status: 409 })
})
