import { timingSafeEqual } from "node:crypto"

import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { matchCallParty } from "@/lib/calls/party-match"

export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 8_192
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000
const EVENT_TYPE = "asterisk_human_call_lifecycle"
const EVENT_HASH_PREFIX = "asterisk-human-lifecycle-v1:"
const PROVIDER_UNKNOWN_NO_REDIAL = "provider_unknown_no_redial"
const PROVIDER_CONNECTED_PENDING_RESULT = "provider_connected_pending_result"

const eventIdSchema = z.string().uuid()
const callIdSchema = z.string().uuid()
const occurredAtSchema = z.string().datetime({ offset: true })
const partyNumberSchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[+0-9A-Za-z*#(). _-]+$/u)

const ringingLifecycleSchema = z.object({
  eventId: eventIdSchema,
  callId: callIdSchema,
  state: z.literal("ringing"),
  occurredAt: occurredAtSchema,
  fromNumber: partyNumberSchema,
  toNumber: partyNumberSchema,
}).strict()

const answeredLifecycleSchema = z.object({
  eventId: eventIdSchema,
  callId: callIdSchema,
  state: z.literal("answered"),
  occurredAt: occurredAtSchema,
}).strict()

const terminalLifecycleSchema = z.object({
  eventId: eventIdSchema,
  callId: callIdSchema,
  state: z.enum(["connected", "no_answer", "busy", "failed", "cancelled"]),
  occurredAt: occurredAtSchema,
  durationSeconds: z.number().int().min(0).max(14_400),
}).strict()

const unknownNoRedialLifecycleSchema = z.object({
  eventId: eventIdSchema,
  callId: callIdSchema,
  state: z.literal("unknown_no_redial"),
  occurredAt: occurredAtSchema,
}).strict()

const lifecycleSchema = z.union([
  ringingLifecycleSchema,
  answeredLifecycleSchema,
  terminalLifecycleSchema,
  unknownNoRedialLifecycleSchema,
])
type LifecycleInput = z.infer<typeof lifecycleSchema>
type RingingInput = z.infer<typeof ringingLifecycleSchema>
type TerminalState = Exclude<LifecycleInput["state"], "ringing" | "answered" | "unknown_no_redial">

type SafeEventPayload = {
  version: 1
  state: LifecycleInput["state"]
  occurredAt: string
  durationSeconds?: number
}

type BoundHumanCall = {
  id: string
  leadId: string | null
  leadCallClaimToken: string | null
  direction: string
  fromNumber: string
  toNumber: string
  status: string
  duration: number | null
  wasAnswered: boolean
  providerOutcome: string | null
  conversationOutcome: string | null
  startedAt: Date | null
  endedAt: Date | null
}

type ApplyResult = "applied" | "existing"

class LifecycleCallNotFoundError extends Error {}
class LifecycleConflictError extends Error {}
class LifecycleTimestampError extends Error {}

const terminalStatusByState: Record<TerminalState, string> = {
  connected: "completed",
  no_answer: "no-answer",
  busy: "busy",
  failed: "failed",
  cancelled: "canceled",
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN?.trim() || ""
  const received = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/iu)?.[1] || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function safeEventPayload(input: LifecycleInput): SafeEventPayload {
  return input.state === "ringing" || input.state === "answered" || input.state === "unknown_no_redial"
    ? {
        version: 1,
        state: input.state,
        occurredAt: new Date(input.occurredAt).toISOString(),
      }
    : {
        version: 1,
        state: input.state,
        occurredAt: new Date(input.occurredAt).toISOString(),
        durationSeconds: input.durationSeconds,
      }
}

function sameSafePayload(value: Prisma.JsonValue, expected: SafeEventPayload): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  const expectedKeys = expected.durationSeconds === undefined
    ? ["occurredAt", "state", "version"]
    : ["durationSeconds", "occurredAt", "state", "version"]
  const actualKeys = Object.keys(payload).sort()
  if (actualKeys.length !== expectedKeys.length) return false
  if (!actualKeys.every((key, index) => key === expectedKeys[index])) return false
  return payload.version === expected.version
    && payload.state === expected.state
    && payload.occurredAt === expected.occurredAt
    && payload.durationSeconds === expected.durationSeconds
}

function terminalMatches(
  call: BoundHumanCall,
  state: TerminalState,
  occurredAt: Date,
  durationSeconds: number,
): boolean {
  return call.status === terminalStatusByState[state]
    && call.providerOutcome === state
    && call.wasAnswered === (state === "connected")
    && call.duration === durationSeconds
    && call.endedAt?.getTime() === occurredAt.getTime()
}

function validateTimestamp(call: BoundHumanCall, occurredAt: Date, now: Date): void {
  if (occurredAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new LifecycleTimestampError()
  }
  if (
    call.startedAt
    && occurredAt.getTime() < call.startedAt.getTime() - MAX_CLOCK_SKEW_MS
  ) {
    throw new LifecycleConflictError()
  }
}

async function loadBoundCall(
  tx: Prisma.TransactionClient,
  organizationId: string,
  callId: string,
): Promise<BoundHumanCall | null> {
  return tx.callLog.findFirst({
    where: {
      organizationId,
      provider: "asterisk",
      callMode: "human",
      providerCallId: callId,
      callSid: callId,
    },
    select: {
      id: true,
      leadId: true,
      leadCallClaimToken: true,
      direction: true,
      fromNumber: true,
      toNumber: true,
      status: true,
      duration: true,
      wasAnswered: true,
      providerOutcome: true,
      conversationOutcome: true,
      startedAt: true,
      endedAt: true,
    },
  })
}

function ringingIdentityMatches(call: BoundHumanCall, input: RingingInput): boolean {
  return call.direction === "inbound"
    && call.fromNumber === input.fromNumber
    && call.toNumber === input.toNumber
}

async function applyRingingEvent(params: {
  tx: Prisma.TransactionClient
  organizationId: string
  input: RingingInput
  payload: SafeEventPayload
  now: Date
}): Promise<ApplyResult> {
  const occurredAt = new Date(params.payload.occurredAt)
  if (occurredAt.getTime() > params.now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new LifecycleTimestampError()
  }

  const existing = await loadBoundCall(params.tx, params.organizationId, params.input.callId)
  let callLogId: string
  let result: ApplyResult

  if (existing) {
    validateTimestamp(existing, occurredAt, params.now)
    if (!ringingIdentityMatches(existing, params.input)) {
      throw new LifecycleConflictError()
    }
    callLogId = existing.id
    result = "existing"
  } else {
    const matched = await matchCallParty(
      params.tx,
      params.organizationId,
      params.input.fromNumber,
    )
    const created = await params.tx.callLog.create({
      data: {
        organizationId: params.organizationId,
        callSid: params.input.callId,
        providerCallId: params.input.callId,
        direction: "inbound",
        fromNumber: params.input.fromNumber,
        toNumber: params.input.toNumber,
        targetPhoneE164: matched.targetPhoneE164 ?? null,
        status: "ringing",
        provider: "asterisk",
        callMode: "human",
        wasAnswered: false,
        contactId: matched.contactId,
        leadId: matched.leadId,
        startedAt: occurredAt,
      },
      select: { id: true },
    })
    callLogId = created.id
    result = "applied"
  }

  // Phone identity lives only in CallLog. The append-only journal proves the
  // transition without duplicating customer PII into a second table.
  await params.tx.callEvent.create({
    data: {
      organizationId: params.organizationId,
      callLogId,
      provider: "asterisk",
      providerCallId: params.input.callId,
      eventType: EVENT_TYPE,
      eventHash: `${EVENT_HASH_PREFIX}${params.input.eventId}`,
      payload: params.payload as unknown as Prisma.InputJsonValue,
    },
  })

  return result
}

async function releaseTerminalBrowserLeadClaim(
  tx: Prisma.TransactionClient,
  organizationId: string,
  call: BoundHumanCall,
): Promise<void> {
  if (!call.leadId || !call.leadCallClaimToken) return
  // The call's token is a CAS guard: a terminal event that arrived after this
  // lease expired cannot clear a newer salesperson's claim.
  await tx.lead.updateMany({
    where: {
      id: call.leadId,
      organizationId,
      browserCallClaimToken: call.leadCallClaimToken,
    },
    data: {
      browserCallClaimToken: null,
      browserCallClaimedByUserId: null,
      browserCallClaimedAt: null,
      browserCallClaimExpiresAt: null,
    },
  })
}

async function applyLifecycleEvent(params: {
  organizationId: string
  input: LifecycleInput
  payload: SafeEventPayload
  now: Date
}): Promise<ApplyResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (params.input.state === "ringing") {
      return applyRingingEvent({
        tx,
        organizationId: params.organizationId,
        input: params.input,
        payload: params.payload,
        now: params.now,
      })
    }

    const call = await loadBoundCall(tx, params.organizationId, params.input.callId)
    if (!call) throw new LifecycleCallNotFoundError()

    const occurredAt = new Date(params.payload.occurredAt)
    validateTimestamp(call, occurredAt, params.now)

    // The event journal and CallLog transition commit atomically. The payload
    // deliberately contains no phone number, contact, lead, transcript, SIP
    // address, credential, or raw PBX event.
    await tx.callEvent.create({
      data: {
        organizationId: params.organizationId,
        callLogId: call.id,
        provider: "asterisk",
        providerCallId: params.input.callId,
        eventType: EVENT_TYPE,
        eventHash: `${EVENT_HASH_PREFIX}${params.input.eventId}`,
        payload: params.payload as unknown as Prisma.InputJsonValue,
      },
    })

    if (params.input.state === "answered") {
      if (call.providerOutcome !== null || call.endedAt !== null) {
        // A delayed answer observation cannot reopen or regress a terminal
        // CallLog. It is still journaled so an exact retry is a no-op.
        return "existing"
      }

      const updated = await tx.callLog.updateMany({
        where: {
          id: call.id,
          organizationId: params.organizationId,
          provider: "asterisk",
          callMode: "human",
          providerCallId: params.input.callId,
          callSid: params.input.callId,
          providerOutcome: null,
          endedAt: null,
        },
        data: {
          status: "in-progress",
          wasAnswered: true,
        },
      })
      if (updated.count === 1) return "applied"

      const refreshed = await loadBoundCall(tx, params.organizationId, params.input.callId)
      if (
        refreshed
        && (
          refreshed.providerOutcome !== null
          || refreshed.endedAt !== null
          || (
            refreshed.status === "in-progress"
            && refreshed.wasAnswered
            && refreshed.providerOutcome === null
          )
        )
      ) {
        return "existing"
      }
      throw new LifecycleConflictError()
    }

    if (params.input.state === "unknown_no_redial") {
      if (call.providerOutcome !== null) return "existing"
      if (
        call.wasAnswered
        && call.status === "completed"
        && call.conversationOutcome === PROVIDER_CONNECTED_PENDING_RESULT
      ) return "existing"
      if (
        call.status === "dispatch-uncertain"
        && call.conversationOutcome === PROVIDER_UNKNOWN_NO_REDIAL
      ) return "existing"

      if (call.wasAnswered) {
        const connected = await tx.callLog.updateMany({
          where: {
            id: call.id,
            organizationId: params.organizationId,
            provider: "asterisk",
            callMode: "human",
            providerCallId: params.input.callId,
            callSid: params.input.callId,
            providerOutcome: null,
            conversationOutcome: null,
            wasAnswered: true,
          },
          data: {
            status: "completed",
            conversationOutcome: PROVIDER_CONNECTED_PENDING_RESULT,
            endedAt: occurredAt,
            browserAnswerClaimToken: null,
            browserAnswerClaimExpiresAt: null,
          },
        })
        if (connected.count === 1) return "applied"
        throw new LifecycleConflictError()
      }

      const updated = await tx.callLog.updateMany({
        where: {
          id: call.id,
          organizationId: params.organizationId,
          provider: "asterisk",
          callMode: "human",
          providerCallId: params.input.callId,
          callSid: params.input.callId,
          providerOutcome: null,
          conversationOutcome: null,
          wasAnswered: false,
          endedAt: null,
        },
        data: {
          status: "dispatch-uncertain",
          conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL,
          endedAt: occurredAt,
          browserAnswerClaimToken: null,
          browserAnswerClaimExpiresAt: null,
        },
      })
      if (updated.count === 1) return "applied"

      const refreshed = await loadBoundCall(tx, params.organizationId, params.input.callId)
      if (
        refreshed
        && (
          refreshed.providerOutcome !== null
          || (
            refreshed.status === "dispatch-uncertain"
            && refreshed.conversationOutcome === PROVIDER_UNKNOWN_NO_REDIAL
          )
        )
      ) return "existing"
      throw new LifecycleConflictError()
    }

    const state = params.input.state
    const durationSeconds = params.input.durationSeconds
    if (call.providerOutcome !== null) {
      if (terminalMatches(call, state, occurredAt, durationSeconds)) return "existing"
      throw new LifecycleConflictError()
    }
    if (state !== "connected" && call.wasAnswered) {
      // Once Asterisk proved answer, the same call cannot later be classified
      // as a pre-answer busy/no-answer/failure/cancellation.
      throw new LifecycleConflictError()
    }

    const updated = await tx.callLog.updateMany({
      where: {
        id: call.id,
        organizationId: params.organizationId,
        provider: "asterisk",
        callMode: "human",
        providerCallId: params.input.callId,
        callSid: params.input.callId,
        providerOutcome: null,
        ...(state === "connected" ? {} : { wasAnswered: false }),
      },
      data: {
        status: terminalStatusByState[state],
        wasAnswered: state === "connected",
        providerOutcome: state,
        conversationOutcome: null,
        duration: durationSeconds,
        endedAt: occurredAt,
        browserAnswerClaimToken: null,
        browserAnswerClaimExpiresAt: null,
      },
    })
    if (updated.count === 1) {
      await releaseTerminalBrowserLeadClaim(tx, params.organizationId, call)
      return "applied"
    }

    const refreshed = await loadBoundCall(tx, params.organizationId, params.input.callId)
    if (refreshed && terminalMatches(refreshed, state, occurredAt, durationSeconds)) {
      return "existing"
    }
    throw new LifecycleConflictError()
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}

async function existingReplayResult(params: {
  organizationId: string
  input: LifecycleInput
  payload: SafeEventPayload
}): Promise<ApplyResult> {
  const existing = await prisma.callEvent.findFirst({
    where: {
      organizationId: params.organizationId,
      provider: "asterisk",
      providerCallId: params.input.callId,
      eventType: EVENT_TYPE,
      eventHash: `${EVENT_HASH_PREFIX}${params.input.eventId}`,
    },
    select: { payload: true },
  })
  if (!existing || !sameSafePayload(existing.payload, params.payload)) {
    throw new LifecycleConflictError()
  }
  if (params.input.state === "ringing") {
    const call = await prisma.callLog.findFirst({
      where: {
        organizationId: params.organizationId,
        provider: "asterisk",
        callMode: "human",
        providerCallId: params.input.callId,
        callSid: params.input.callId,
      },
      select: {
        id: true,
        leadId: true,
        leadCallClaimToken: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        duration: true,
        wasAnswered: true,
        providerOutcome: true,
        conversationOutcome: true,
        startedAt: true,
        endedAt: true,
      },
    })
    if (!call || !ringingIdentityMatches(call, params.input)) {
      throw new LifecycleConflictError()
    }
  }
  return "existing"
}

async function applyWithUniqueReplay(params: {
  organizationId: string
  input: LifecycleInput
  payload: SafeEventPayload
  now: Date
}): Promise<ApplyResult> {
  try {
    return await applyLifecycleEvent(params)
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    try {
      return await existingReplayResult(params)
    } catch (replayError) {
      // Two first-seen ringing events can race on CallLog's provider-call
      // unique key. The loser retries once after the winner commits, then
      // journals its own event against the now-existing row.
      if (
        params.input.state !== "ringing"
        || !(replayError instanceof LifecycleConflictError)
      ) {
        throw replayError
      }
      try {
        return await applyLifecycleEvent(params)
      } catch (retryError) {
        if (!isUniqueConflict(retryError)) throw retryError
        return existingReplayResult(params)
      }
    }
  }
}

/**
 * PBX-only lifecycle observer for ordinary (human) Asterisk calls.
 * Tenant, provider and call mode are server-derived. Only the initial ringing
 * event may establish bounded party-number identity; every later event remains
 * the zero-customer-data transition contract used by outbound calls.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()
  if (!organizationId) {
    return NextResponse.json({ error: "Call lifecycle is not configured" }, { status: 503 })
  }

  const bodyText = await request.text()
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  let body: unknown = null
  try {
    body = JSON.parse(bodyText)
  } catch {
    // Keep parser and field details out of this internal callback response.
  }
  const parsed = lifecycleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid lifecycle event" }, { status: 400 })
  }

  const payload = safeEventPayload(parsed.data)
  try {
    const result = await runWithTenant(organizationId, async () => {
      return applyWithUniqueReplay({
        organizationId,
        input: parsed.data,
        payload,
        now: new Date(),
      })
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    if (error instanceof LifecycleCallNotFoundError) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 })
    }
    if (error instanceof LifecycleConflictError) {
      return NextResponse.json({ error: "Lifecycle conflict" }, { status: 409 })
    }
    if (error instanceof LifecycleTimestampError) {
      return NextResponse.json({ error: "Invalid lifecycle event" }, { status: 400 })
    }
    console.error("[asterisk-human-lifecycle] callback failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
