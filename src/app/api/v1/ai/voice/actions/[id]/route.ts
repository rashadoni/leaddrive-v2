import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import {
  AiVoiceActionDraftError,
  updateAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"

const updateSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
})

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withRlsSessionAuth<RouteContext>(async (req, auth, ctx) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }
  if (!checkRateLimit(`voice:action-update:${auth.orgId}:${auth.userId}`, {
    maxRequests: 30,
    windowMs: 60_000,
  })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", code: "INVALID_UPDATE_REQUEST" }, {
      status: 400,
    })
  }

  try {
    const draft = await updateAiVoiceActionDraft(auth, {
      intentId: id,
      ...parsed.data,
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
    console.error("[voice action update]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
