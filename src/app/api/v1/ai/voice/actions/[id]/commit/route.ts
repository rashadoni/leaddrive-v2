import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { AiVoiceActionDraftError } from "@/lib/ai/voice/action-draft"
import {
  AiVoiceActionExecutionClaimError,
  claimAiVoiceActionExecution,
  failClaimedAiVoiceActionExecution,
  recoverAiVoiceActionExecutionLease,
  type AiVoiceActionExecutionClaim,
} from "@/lib/ai/voice/action-execution-claim"
import {
  AiVoiceActionExecutionError,
  executeClaimedAiVoiceAction,
} from "@/lib/ai/voice/action-execution"
import { CrmCommandError } from "@/lib/crm-commands/errors"

const identifierSchema = z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9_-]+$/)
const commitSchema = z.strictObject({
  confirmationEventId: identifierSchema,
  confirmationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expectedRevision: z.number().int().positive(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
})

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const
const USER_COMMIT_LIMIT = { maxRequests: 20, windowMs: 60_000 } as const
const TENANT_COMMIT_LIMIT = { maxRequests: 200, windowMs: 60_000 } as const
const ACTION_COMMIT_LIMIT = { maxRequests: 10, windowMs: 60_000 } as const
const TERMINAL_EXECUTION_CODES = new Set([
  "INTENT_INTEGRITY_FAILED",
  "INVALID_STORED_ACTION",
  "INVALID_STORED_PAYLOAD",
  "TARGET_REQUIRED",
])

type RouteContext = { params: Promise<{ id: string }> }

type TerminalFailure = Readonly<{
  code: string
  message: string
  status: 400 | 403 | 404 | 409
}>

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

function knownBoundaryError(error: unknown):
  | AiVoiceActionDraftError
  | AiVoiceActionExecutionClaimError
  | AiVoiceActionExecutionError
  | null {
  return error instanceof AiVoiceActionDraftError
    || error instanceof AiVoiceActionExecutionClaimError
    || error instanceof AiVoiceActionExecutionError
    ? error
    : null
}

function terminalFailure(error: unknown): TerminalFailure | null {
  if (error instanceof CrmCommandError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  if (error instanceof AiVoiceActionExecutionError && TERMINAL_EXECUTION_CODES.has(error.code)) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}

function safeErrorIdentity(error: unknown): Readonly<{ name: string; code?: string }> {
  const name = error instanceof Error ? error.name : "UnknownError"
  const code = error
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "string"
    && /^[A-Z][A-Z0-9_]{0,63}$/.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : undefined
  return { name, ...(code ? { code } : {}) }
}

async function executableClaim(
  auth: Parameters<typeof claimAiVoiceActionExecution>[0],
  claim: AiVoiceActionExecutionClaim,
): Promise<AiVoiceActionExecutionClaim> {
  if (claim.state !== "executing") return claim
  if (new Date(claim.executionLeaseExpiresAt).getTime() > Date.now()) return claim
  return recoverAiVoiceActionExecutionLease(auth, {
    intentId: claim.intentId,
    expectedRevision: claim.revision,
    payloadHash: claim.payloadHash,
    expiredLeaseToken: claim.executionLeaseToken,
  })
}

/**
 * Consume an explicit browser confirmation and execute one server-owned CRM
 * action. This endpoint is session-only and is intentionally never registered
 * as a realtime/model tool.
 */
export const POST = withRlsSessionAuth<RouteContext>(async (req, auth, ctx) => {
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) return json({ error: "Forbidden", reason: gate.reason }, 403)

  const { id: rawIntentId } = await ctx.params
  const intentId = identifierSchema.safeParse(rawIntentId)
  const body = await req.json().catch(() => null)
  const parsed = commitSchema.safeParse(body)
  if (!intentId.success || !parsed.success) {
    return json({ error: "Invalid request", code: "INVALID_COMMIT_REQUEST" }, 400)
  }

  if (!checkRateLimit(
    `voice:action-commit:user:${auth.orgId}:${auth.userId}`,
    USER_COMMIT_LIMIT,
  )) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, {
      status: 429,
      headers: { ...NO_STORE_HEADERS, "Retry-After": "60" },
    })
  }
  if (!checkRateLimit(`voice:action-commit:tenant:${auth.orgId}`, TENANT_COMMIT_LIMIT)) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, {
      status: 429,
      headers: { ...NO_STORE_HEADERS, "Retry-After": "60" },
    })
  }
  if (!checkRateLimit(
    `voice:action-commit:action:${auth.orgId}:${auth.userId}:${intentId.data}`,
    ACTION_COMMIT_LIMIT,
  )) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, {
      status: 429,
      headers: { ...NO_STORE_HEADERS, "Retry-After": "60" },
    })
  }

  let claim: AiVoiceActionExecutionClaim
  try {
    claim = await claimAiVoiceActionExecution(auth, {
      intentId: intentId.data,
      ...parsed.data,
    })
    claim = await executableClaim(auth, claim)
  } catch (error) {
    const known = knownBoundaryError(error)
    if (known) return json({ error: known.message, code: known.code }, known.status)
    console.error("[voice action commit claim]", safeErrorIdentity(error))
    return json({ error: "Commit temporarily unavailable", code: "COMMIT_RETRY_REQUIRED" }, 503)
  }

  if (claim.state === "failed") {
    return json({
      success: false,
      error: "The action previously failed",
      code: claim.errorCode,
      data: { intentId: claim.intentId, state: claim.state, replayed: true },
    }, 409)
  }

  try {
    const result = await executeClaimedAiVoiceAction(auth, {
      intentId: claim.intentId,
      executionLeaseToken: claim.executionLeaseToken,
    })
    return json({ success: true, data: result }, 200)
  } catch (error) {
    const failure = terminalFailure(error)
    if (failure) {
      try {
        const settled = await failClaimedAiVoiceActionExecution(auth, {
          intentId: claim.intentId,
          executionLeaseToken: claim.executionLeaseToken,
          errorCode: failure.code,
          safeMessage: failure.message,
        })
        return json({ success: false, error: failure.message, code: failure.code, data: settled }, failure.status)
      } catch (settlementError) {
        console.error("[voice action commit settlement]", safeErrorIdentity(settlementError))
        return json({ error: "Commit temporarily unavailable", code: "COMMIT_RETRY_REQUIRED" }, 503)
      }
    }

    const known = knownBoundaryError(error)
    if (known) return json({ error: known.message, code: known.code }, known.status)
    console.error("[voice action commit execution]", safeErrorIdentity(error))
    return json({ error: "Commit temporarily unavailable", code: "COMMIT_RETRY_REQUIRED" }, 503)
  }
})
