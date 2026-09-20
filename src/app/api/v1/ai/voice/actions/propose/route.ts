import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import {
  AiVoiceActionDraftError,
  createAiVoiceActionDraft,
} from "@/lib/ai/voice/action-draft"
import { VOICE_PROPOSE_TOOL_NAMES } from "@/lib/ai/voice/propose-tools"
import { resolveVoiceProposal } from "@/lib/ai/voice/propose-resolve"
import { RECORD_TYPE_NAMES } from "@/lib/ai/voice/record-types"

/**
 * Turn one model proposal into an uncommitted draft the user can review
 * (roadmap V1.5).
 *
 * This endpoint is the entire bridge between what the assistant understood and
 * what the CRM might be asked to do, and it is careful about three things.
 *
 * - **It cannot execute anything.** It resolves names, then calls the same
 *   draft creator the receipt UI already reads from. Commit lives behind a
 *   separate route that requires a one-time proof minted by a button press.
 * - **It takes no identifiers from the model.** `screen` comes from the
 *   browser's own location, and every id in the stored payload was read from
 *   the database for this user in this organization.
 * - **It refuses rather than guesses.** An unresolved or ambiguous name comes
 *   back as a clarification for the assistant to ask about; it never becomes
 *   a silently chosen colleague or lead.
 *
 * Session-only, same-origin, no bearer callers — identical to the rest of the
 * voice action surface.
 */

const screenSchema = z.strictObject({
  recordType: z.enum(RECORD_TYPE_NAMES).optional(),
  recordId: z.string().trim().min(1).max(191).optional(),
})

const proposeRequestSchema = z.strictObject({
  voiceSessionId: z.string().trim().min(1).max(191),
  tool: z.enum(VOICE_PROPOSE_TOOL_NAMES),
  args: z.record(z.string(), z.unknown()),
  providerToolCallId: z.string().trim().min(1).max(255).optional(),
  screen: screenSchema.optional(),
})

export const POST = withRlsSessionAuth(async (req, auth) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) {
    return NextResponse.json({ error: "Forbidden", reason: gate.reason }, { status: 403 })
  }

  // A proposal costs a name lookup and a draft write, and the model can emit
  // them in a loop far faster than a person can read one.
  if (!checkRateLimit(`voice:action-propose:${auth.orgId}:${auth.userId}`, {
    maxRequests: 20,
    windowMs: 60_000,
  })) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = proposeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", code: "INVALID_PROPOSE_REQUEST" }, {
      status: 400,
    })
  }

  const resolution = await resolveVoiceProposal(
    auth,
    parsed.data.tool,
    parsed.data.args,
    parsed.data.screen ?? {},
  )

  if (resolution.kind === "invalid") {
    return NextResponse.json({
      success: false,
      code: "INVALID_PROPOSAL",
      issues: resolution.issues,
    }, { status: 400, headers: { "Cache-Control": "private, no-store" } })
  }

  if (resolution.kind === "clarify") {
    // 200, not an error: the assistant asked a well-formed question whose
    // answer is a person's, and it needs the candidate names to ask it.
    return NextResponse.json({
      success: false,
      needsClarification: true,
      code: resolution.code,
      field: resolution.field,
      candidates: resolution.candidates.map((candidate) => candidate.label),
    }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  }

  try {
    const draft = await createAiVoiceActionDraft(auth, {
      voiceSessionId: parsed.data.voiceSessionId,
      actionType: resolution.actionType,
      payload: resolution.payload,
      // One draft per provider tool call. A retried tool call replays the same
      // receipt instead of stacking a second pending action.
      idempotencyKey: `propose:${parsed.data.providerToolCallId ?? crypto.randomUUID()}`,
      ...(parsed.data.providerToolCallId
        ? { providerToolCallId: parsed.data.providerToolCallId }
        : {}),
      ...(resolution.targetEntityId ? { targetEntityId: resolution.targetEntityId } : {}),
    })
    return NextResponse.json({ success: true, data: draft }, {
      status: draft.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    if (error instanceof AiVoiceActionDraftError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      }, { status: error.status, headers: { "Cache-Control": "private, no-store" } })
    }
    console.error("[voice action propose]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
