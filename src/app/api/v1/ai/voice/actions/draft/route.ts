import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import {
  AI_VOICE_ACTION_TYPES,
  type AiVoiceActionType,
} from "@/lib/ai/voice/action-registry"
import {
  AiVoiceActionDraftError,
  createAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"

const draftRequestSchema = z.strictObject({
  voiceSessionId: z.string().trim().min(1).max(191),
  actionType: z.enum(AI_VOICE_ACTION_TYPES),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string()
    .trim()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid idempotencyKey"),
  providerToolCallId: z.string().trim().min(1).max(255).optional(),
  targetEntityId: z.string().trim().min(1).max(191).optional(),
})

/**
 * Create a server-owned, uncommitted voice action draft.
 *
 * This endpoint deliberately cannot execute a CRM command. It accepts only an
 * authenticated same-origin browser session, re-derives actor/tenant identity,
 * validates the closed action registry and returns a receipt that a later UI
 * can display. A separate commit endpoint does not exist yet.
 */
export const POST = withRlsSessionAuth(async (req, auth) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }

  if (!checkRateLimit(`voice:action-draft:${auth.orgId}:${auth.userId}`, {
    maxRequests: 20,
    windowMs: 60_000,
  })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = draftRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid request",
      code: "INVALID_DRAFT_REQUEST",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      })),
    }, { status: 400 })
  }

  try {
    const draft = await createAiVoiceActionDraft(auth, {
      ...parsed.data,
      actionType: parsed.data.actionType as AiVoiceActionType,
    })
    return NextResponse.json(
      { success: true, data: draft },
      { status: draft.replayed ? 200 : 201 },
    )
  } catch (error) {
    if (error instanceof AiVoiceActionDraftError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      }, { status: error.status })
    }
    console.error("[voice action draft]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
