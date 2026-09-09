/**
 * Implementation for POST /api/v1/calls/[id]/transcribe (C4 Call Transcription).
 *
 * Lives in a non-route module so route.ts exports only handlers (Next.js
 * route-type constraint), while the injected-client impl stays unit-testable
 * (src/__tests__/api-calls-transcribe.test.ts).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { canReadCall } from "@/lib/calls/access"
import { resolveTranscriptionClient } from "@/lib/transcription/transcribe"
import {
  isValidAudioUrl,
  TRANSCRIPTION_LIMITS,
  type TranscriptionClient,
} from "@/lib/transcription/types"

const bodySchema = z.object({
  /** Optional override — useful for re-transcribing a call after a
   *  recording URL was rotated by the provider. */
  audioUrl: z.string().max(TRANSCRIPTION_LIMITS.maxUrlLength).optional(),
  language: z.string().max(TRANSCRIPTION_LIMITS.maxLanguageLength).optional(),
  prompt: z.string().max(TRANSCRIPTION_LIMITS.maxPromptLength).optional(),
  /** Re-transcribe even if `transcription` is already set. Default false
   *  — protects against duplicate paid Whisper calls. */
  force: z.boolean().optional(),
})

/** Injected client lets tests provide a stub without touching env. */
export async function postWithClient(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  injectedClient?: TranscriptionClient | null,
) {
  const auth = await requireAuth(req, "ai", "write")
  if (isAuthError(auth)) return auth
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { body = {} }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // org-known (auth.orgId) — wrap the org-scoped reads/writes so they run in
  // tenant context (the route is a thin shell that delegates here without wrapping).
  return runWithTenant(auth.orgId, async () => {
  const call = await prisma.callLog.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      recordingUrl: true,
      transcription: true,
      duration: true,
      conversationId: true,
      ticketId: true,
      dealId: true,
      leadId: true,
      companyId: true,
      contactId: true,
      callMode: true,
      userId: true,
    },
  })
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canReadCall(auth.role, call, auth.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (call.callMode === "ai") {
    return NextResponse.json(
      { error: "AI-call transcripts are written only by the correlated voice-agent callback" },
      { status: 409 },
    )
  }

  // Idempotency — don't re-charge for an already-transcribed call
  // unless the caller explicitly opted in via `force`.
  if (call.transcription && parsed.data.force !== true) {
    return NextResponse.json({
      success: true,
      cached: true,
      transcript: call.transcription,
    })
  }

  const audioUrl = parsed.data.audioUrl ?? call.recordingUrl ?? ""
  if (!audioUrl) {
    return NextResponse.json(
      { error: "Call has no recordingUrl — supply `audioUrl` in body or wait for the recording to land" },
      { status: 409 },
    )
  }
  if (!isValidAudioUrl(audioUrl)) {
    return NextResponse.json({ error: "audioUrl must be a valid http(s) URL" }, { status: 400 })
  }

  // Resolve provider — explicit-injected wins for tests + DI.
  const client = injectedClient !== undefined ? injectedClient : resolveTranscriptionClient()
  if (!client) {
    return NextResponse.json(
      { error: "Transcription provider not configured (set OPENAI_API_KEY)" },
      { status: 503 },
    )
  }

  try {
    const result = await client.transcribe({
      audioUrl,
      language: parsed.data.language,
      prompt: parsed.data.prompt,
    })

    await prisma.callLog.update({
      where: { id },
      data: {
        transcription: result.transcript,
        // Backfill duration only when CallLog didn't already have one
        // (Twilio webhook may have stamped it already).
        ...(call.duration == null && typeof result.durationSeconds === "number"
          ? { duration: Math.round(result.durationSeconds) }
          : {}),
      },
    })

    return NextResponse.json({
      success: true,
      cached: false,
      transcript: result.transcript,
      language: result.language,
      provider: result.provider,
    })
  } catch (e) {
    console.error(`[calls/${id}/transcribe] provider error:`, e)
    return NextResponse.json(
      { error: "Transcription failed", message: (e as Error).message },
      { status: 502 },
    )
  }
  })
}
