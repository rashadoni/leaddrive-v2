import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import {
  AiVoiceActionDraftError,
  cancelAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"

const cancelSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
})

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRlsSessionAuth<RouteContext>(async (req, auth, ctx) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }
  if (!checkRateLimit(`voice:action-cancel:${auth.orgId}:${auth.userId}`, {
    maxRequests: 30,
    windowMs: 60_000,
  })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const parsed = cancelSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", code: "INVALID_CANCEL_REQUEST" }, {
      status: 400,
    })
  }

  try {
    const draft = await cancelAiVoiceActionDraft(auth, {
      intentId: id,
      expectedRevision: parsed.data.expectedRevision,
    })
    return NextResponse.json({ success: true, data: draft })
  } catch (error) {
    if (error instanceof AiVoiceActionDraftError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      }, { status: error.status })
    }
    console.error("[voice action cancel]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
