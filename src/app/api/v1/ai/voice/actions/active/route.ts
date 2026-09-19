import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import {
  AiVoiceActionDraftError,
  getActiveAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"

const querySchema = z.strictObject({
  voiceSessionId: z.string().trim().min(1).max(191),
})

export const GET = withRlsSessionAuth(async (req, auth) => {
  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }
  if (!checkRateLimit(`voice:action-active:${auth.orgId}:${auth.userId}`, {
    maxRequests: 60,
    windowMs: 60_000,
  })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const parsed = querySchema.safeParse({
    voiceSessionId: req.nextUrl.searchParams.get("voiceSessionId"),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", code: "INVALID_ACTIVE_REQUEST" }, {
      status: 400,
    })
  }

  try {
    const draft = await getActiveAiVoiceActionDraft(auth, parsed.data.voiceSessionId)
    return NextResponse.json({ success: true, data: draft }, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    if (error instanceof AiVoiceActionDraftError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      }, { status: error.status })
    }
    console.error("[voice action active]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
