import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoiceWriteAccess } from "@/lib/ai/voice/gate"
import {
  AiVoiceActionDraftError,
  issueAiVoiceActionConfirmationProof,
} from "@/lib/ai/voice/action-draft"

const confirmationSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  confirmed: z.literal(true),
})

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Record an explicit receipt-button confirmation and return a short-lived
 * proof. This endpoint cannot execute a CRM command; the separate commit route
 * consumes the proof exactly once after repeating every authorization check.
 */
export const POST = withRlsSessionAuth<RouteContext>(async (req, auth, ctx) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const gate = await checkVoiceWriteAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }
  if (!checkRateLimit(`voice:action-confirmation:${auth.orgId}:${auth.userId}`, {
    maxRequests: 10,
    windowMs: 60_000,
  })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const parsed = confirmationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid request",
      code: "INVALID_CONFIRMATION_REQUEST",
    }, { status: 400 })
  }

  try {
    const proof = await issueAiVoiceActionConfirmationProof(auth, {
      intentId: id,
      expectedRevision: parsed.data.expectedRevision,
      payloadHash: parsed.data.payloadHash,
    })
    return NextResponse.json({ success: true, data: proof }, {
      status: 201,
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
    console.error("[voice action confirmation]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
