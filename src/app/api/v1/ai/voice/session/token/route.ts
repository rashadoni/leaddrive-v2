import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { getOrgModuleContext } from "@/lib/api-auth"
import { accessibleVoiceSectionKeys } from "@/lib/ai/voice/read-access"
import { MAX_SESSION_SECONDS, readVoicePilotConfig } from "@/lib/ai/voice/config"
import {
  createGeminiLiveToken,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
} from "@/lib/ai/voice/gemini-live"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { geminiVoiceMarker } from "@/lib/ai/voice/session-marker"

const bodySchema = z.object({
  voiceSessionId: z.string().min(6).max(64),
}).strict()

/**
 * Mint the browser a one-use Gemini Live credential.
 *
 * The authenticated user, tenant, RBAC sections, model, voice, system prompt,
 * tools, VAD and transcription settings are all derived or locked server-side.
 * The long-lived Gemini API key never crosses this boundary.
 */
export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard
  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!checkRateLimit(`voice:token:${auth.orgId}:${auth.userId}`, { maxRequests: 6, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const session = await prisma.voiceSession.findFirst({
    where: {
      id: parsed.data.voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
    },
    select: { locale: true, expiresAt: true },
  })
  if (!session || session.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Session expired" }, { status: 409 })
  }

  const apiKey = readVoicePilotConfig().geminiApiKey
  if (!apiKey) return NextResponse.json({ error: "Voice provider unavailable" }, { status: 503 })

  const [me, orgCtx] = await Promise.all([
    prisma.user.findFirst({
      where: { id: auth.userId, organizationId: auth.orgId },
      select: { name: true },
    }),
    getOrgModuleContext(auth.orgId),
  ])
  const allowedSections = accessibleVoiceSectionKeys(auth.role, orgCtx)

  // This nullable legacy provider-id column is the durable one-shot latch. Its
  // historical name is retained to avoid a risky schema migration for a value
  // that is never exposed as a provider conversation id.
  const nonce = randomUUID()
  const mintingMarker = geminiVoiceMarker("minting", nonce)
  const issuedMarker = geminiVoiceMarker("issued", nonce)
  const claimed = await prisma.voiceSession.updateMany({
    where: {
      id: parsed.data.voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      expiresAt: { gt: new Date() },
      elevenlabsConversationId: null,
    },
    data: { elevenlabsConversationId: mintingMarker },
  })
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "Session already connecting or connected" }, { status: 409 })
  }

  try {
    const credential = await createGeminiLiveToken({
      apiKey,
      locale: session.locale,
      firstName: (me?.name ?? "").trim().split(/\s+/)[0] ?? "",
      allowedSections,
      maxSessionSeconds: MAX_SESSION_SECONDS,
    })

    const finalized = await prisma.voiceSession.updateMany({
      where: {
        id: parsed.data.voiceSessionId,
        organizationId: auth.orgId,
        userId: auth.userId,
        status: "active",
        elevenlabsConversationId: mintingMarker,
      },
      data: { elevenlabsConversationId: issuedMarker },
    })
    if (finalized.count !== 1) {
      return NextResponse.json({ error: "Session is no longer active" }, { status: 409 })
    }

    return NextResponse.json(
      {
        data: {
          token: credential.token,
          expiresAt: credential.expiresAt,
          model: GEMINI_LIVE_MODEL,
          apiVersion: GEMINI_LIVE_API_VERSION,
          connectionId: nonce,
        },
      },
      { headers: { "Cache-Control": "no-store, private" } },
    )
  } catch {
    // A failed mint remains claimed. Whether Google received the request is not
    // safely knowable for transport/time-out failures; reopening the same CRM
    // session could mint a second paid credential. The client's bounded /end
    // call settles this attempt, and a new click starts a new CRM session.
    console.error("[voice] Gemini Live token mint failed")
    return NextResponse.json({ error: "Voice provider unavailable" }, { status: 502 })
  }
})
