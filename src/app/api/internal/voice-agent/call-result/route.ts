import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { AI_CONNECTED_PENDING_RESULT } from "@/lib/voice-agent/call-history"
import {
  analyzeVoiceCall,
  fallbackPostCallAnalysis,
  formatVoiceTranscript,
  toConversationInsight,
  voiceAgentCallResultSchema,
  type VoiceAgentProviderOutcome,
} from "@/lib/voice-agent/post-call"
import { recordCallCommitment } from "@/lib/commitments/record-call-commitment"
import { maybePlaceCallback } from "@/lib/voice-agent/callback-trigger"
import { recordUnansweredCallback } from "@/lib/voice-agent/callback-fallback-task"
import type { ConversationInsight } from "@/lib/conversation-intel/types"

export const dynamic = "force-dynamic"

function authorized(request: NextRequest): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

const callLogStatusByOutcome: Record<VoiceAgentProviderOutcome, string> = {
  connected: "completed",
  no_answer: "no-answer",
  busy: "busy",
  failed: "failed",
  cancelled: "canceled",
}

const voiceSessionStatusByOutcome: Record<VoiceAgentProviderOutcome, string> = {
  connected: "completed",
  no_answer: "no_answer",
  busy: "busy",
  failed: "failed",
  cancelled: "cancelled",
}

const queueItemTerminalByOutcome: Record<VoiceAgentProviderOutcome, {
  status: string
  outcome: string
}> = {
  connected: { status: "completed", outcome: "connected" },
  no_answer: { status: "no_answer", outcome: "no_answer" },
  busy: { status: "busy", outcome: "busy" },
  failed: { status: "failed", outcome: "failed" },
  cancelled: { status: "cancelled", outcome: "cancelled" },
}

type LateQueueCorrectionDb = Pick<
  Prisma.TransactionClient,
  "voiceCallQueueItem" | "voiceCallQueue"
>

/**
 * Correct only the exact provider-unknown item. A late PBX callback is
 * authoritative, clears every item fence, then completes a drained queue or
 * leaves remaining work paused for an explicit operator resume.
 */
async function correctLateResolvedQueueItem(params: {
  db: LateQueueCorrectionDb
  organizationId: string
  voiceCallSessionId: string
  queueItem: {
    id: string
    queueId: string
    ownerUserId: string
  } | null
  providerOutcome: VoiceAgentProviderOutcome
  endedAt: Date
}): Promise<void> {
  if (!params.queueItem) return
  const terminal = queueItemTerminalByOutcome[params.providerOutcome]
  const changed = await params.db.voiceCallQueueItem.updateMany({
    where: {
      id: params.queueItem.id,
      organizationId: params.organizationId,
      queueId: params.queueItem.queueId,
      ownerUserId: params.queueItem.ownerUserId,
      voiceCallSessionId: params.voiceCallSessionId,
      OR: [
        {
          status: "skipped",
          outcome: "skipped",
          blockReason: {
            in: ["operator_closed_unknown_no_redial", PROVIDER_UNKNOWN_NO_REDIAL],
          },
          queuedLeadKey: null,
          queuedPhoneKey: null,
          activeOrganizationKey: null,
          activeOwnerKey: null,
          leaseToken: null,
          leaseUntil: null,
        },
        {
          status: "dispatch_uncertain",
          outcome: null,
          blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
          activeOrganizationKey: null,
          activeOwnerKey: null,
          leaseToken: null,
          leaseUntil: null,
        },
      ],
    },
    data: {
      status: terminal.status,
      outcome: terminal.outcome,
      queuedLeadKey: null,
      queuedPhoneKey: null,
      activeOrganizationKey: null,
      activeOwnerKey: null,
      leaseToken: null,
      leaseUntil: null,
      blockReason: null,
      endedAt: params.endedAt,
    },
  })
  if (changed.count !== 1) return

  const remaining = await params.db.voiceCallQueueItem.count({
    where: {
      organizationId: params.organizationId,
      queueId: params.queueItem.queueId,
      status: { notIn: ["completed", "no_answer", "busy", "failed", "cancelled", "blocked", "skipped"] },
    },
  })
  if (remaining === 0) {
    await params.db.voiceCallQueue.updateMany({
      where: {
        id: params.queueItem.queueId,
        organizationId: params.organizationId,
        ownerUserId: params.queueItem.ownerUserId,
        status: { in: ["attention_required", "paused"] },
      },
      data: {
        status: "completed",
        activeOrganizationKey: null,
        activeOwnerKey: null,
        completedAt: params.endedAt,
      },
    })
    return
  }
  await params.db.voiceCallQueue.updateMany({
    where: {
      id: params.queueItem.queueId,
      organizationId: params.organizationId,
      ownerUserId: params.queueItem.ownerUserId,
      status: "attention_required",
    },
    data: { status: "paused", pausedAt: params.endedAt },
  })
}

const ANALYSIS_EVENT_HASH = "voice-post-call-analysis-v1"
const ANALYSIS_LEASE_MS = 90_000
const PROVIDER_UNKNOWN_NO_REDIAL = "provider_unknown_no_redial"

type AnalysisClaimPayload = {
  state: "processing"
  claimId: string
  leaseUntil: string
}

type AnalysisClaim =
  | { state: "acquired"; eventId: string; payload: AnalysisClaimPayload }
  | { state: "processing" }
  | { state: "complete" }

type PersistedTerminalCall = {
  providerOutcome: string | null
  insightsAt: Date | null
  transcription: string | null
  duration: number | null
  conversationOutcome: string | null
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function payloadRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function acquireAnalysisClaim(params: {
  organizationId: string
  callLogId: string
  providerCallId: string
  now: Date
}): Promise<AnalysisClaim> {
  const payload: AnalysisClaimPayload = {
    state: "processing",
    claimId: randomUUID(),
    leaseUntil: new Date(params.now.getTime() + ANALYSIS_LEASE_MS).toISOString(),
  }
  try {
    const created = await prisma.callEvent.create({
      data: {
        organizationId: params.organizationId,
        callLogId: params.callLogId,
        provider: "asterisk",
        providerCallId: params.providerCallId,
        eventType: "voice_analysis_claim",
        eventHash: ANALYSIS_EVENT_HASH,
        payload,
      },
      select: { id: true },
    })
    return { state: "acquired", eventId: created.id, payload }
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
  }

  const existing = await prisma.callEvent.findFirst({
    where: {
      organizationId: params.organizationId,
      provider: "asterisk",
      providerCallId: params.providerCallId,
      eventHash: ANALYSIS_EVENT_HASH,
    },
    select: { id: true, eventType: true, payload: true },
  })
  if (!existing) return { state: "processing" }
  if (existing.eventType === "voice_analysis_complete") return { state: "complete" }

  const existingPayload = payloadRecord(existing.payload)
  const existingLease = typeof existingPayload.leaseUntil === "string"
    ? Date.parse(existingPayload.leaseUntil)
    : Number.NaN
  if (Number.isFinite(existingLease) && existingLease > params.now.getTime()) {
    return { state: "processing" }
  }

  // The prior worker died or left malformed claim state. JSON equality is the
  // compare-and-swap token: only one retry can take an expired lease.
  const stolen = await prisma.callEvent.updateMany({
    where: {
      id: existing.id,
      organizationId: params.organizationId,
      eventType: "voice_analysis_claim",
      payload: { equals: existing.payload as Prisma.InputJsonValue },
    },
    data: { payload },
  })
  return stolen.count === 1
    ? { state: "acquired", eventId: existing.id, payload }
    : { state: "processing" }
}

async function completeAnalysisClaim(params: {
  organizationId: string
  eventId: string
  payload: AnalysisClaimPayload
  completedAt: Date
}): Promise<void> {
  await prisma.callEvent.updateMany({
    where: {
      id: params.eventId,
      organizationId: params.organizationId,
      eventType: "voice_analysis_claim",
      payload: { equals: params.payload as unknown as Prisma.InputJsonValue },
    },
    data: {
      eventType: "voice_analysis_complete",
      payload: { state: "complete", completedAt: params.completedAt.toISOString() },
    },
  })
}

function matchesPersistedTerminalResult(params: {
  persisted: PersistedTerminalCall
  providerOutcome: VoiceAgentProviderOutcome
  conversationOutcome: string
  durationSeconds: number
  transcription: string | null
}): boolean {
  return params.persisted.providerOutcome === params.providerOutcome
    && params.persisted.conversationOutcome === params.conversationOutcome
    && params.persisted.duration === params.durationSeconds
    && params.persisted.transcription === params.transcription
}

function conflictingTerminalResult(): NextResponse {
  return NextResponse.json(
    { success: false, analysisStatus: "conflict" },
    { status: 409 },
  )
}

class VoiceSessionTerminalConflictError extends Error {}

async function recordProviderConnectedEvidence(params: {
  organizationId: string
  session: {
    id: string
    outcome: string | null
    queueItem: {
      id: string
      queueId: string
      ownerUserId: string
    } | null
    callLog: {
      id: string
      providerOutcome: string | null
      conversationOutcome: string | null
    }
  }
  callId: string
  observedAt: string
}): Promise<"recorded" | "existing" | "conflict"> {
  const existingProviderOutcome = params.session.callLog.providerOutcome
  if (existingProviderOutcome !== null) {
    return existingProviderOutcome === "connected" ? "existing" : "conflict"
  }
  if (
    params.session.outcome === "connected"
    && params.session.callLog.conversationOutcome === AI_CONNECTED_PENDING_RESULT
  ) return "existing"
  if (
    params.session.outcome !== null
    && params.session.outcome !== "connected"
    && params.session.outcome !== "operator_closed_unknown_no_redial"
  ) return "conflict"

  const now = new Date()
  try {
    const recorded = await runWithTenant(params.organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const callChanged = await tx.callLog.updateMany({
        where: {
          id: params.session.callLog.id,
          organizationId: params.organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: params.callId,
          providerOutcome: null,
          OR: [
            { conversationOutcome: null },
            {
              conversationOutcome: {
                in: [PROVIDER_UNKNOWN_NO_REDIAL, "operator_closed_unknown_no_redial"],
              },
            },
          ],
        },
        data: {
          status: "completed",
          wasAnswered: true,
          conversationOutcome: AI_CONNECTED_PENDING_RESULT,
          endedAt: now,
        },
      })
      if (callChanged.count !== 1) return false

      const sessionChanged = await tx.voiceCallSession.updateMany({
        where: {
          id: params.session.id,
          organizationId: params.organizationId,
          callLogId: params.session.callLog.id,
          providerCallId: params.callId,
          OR: [
            { outcome: null },
            { outcome: "operator_closed_unknown_no_redial" },
          ],
        },
        data: {
          status: "completed",
          outcome: "connected",
          leaseUntil: null,
          activeOrganizationKey: null,
          activeLeadKey: null,
          activePhoneKey: null,
          endedAt: now,
        },
      })
      if (sessionChanged.count !== 1) throw new VoiceSessionTerminalConflictError()

      await correctLateResolvedQueueItem({
        db: tx,
        organizationId: params.organizationId,
        voiceCallSessionId: params.session.id,
        queueItem: params.session.queueItem,
        providerOutcome: "connected",
        endedAt: now,
      })
      await tx.callEvent.createMany({
        data: [{
          organizationId: params.organizationId,
          callLogId: params.session.callLog.id,
          provider: "asterisk",
          providerCallId: params.callId,
          eventType: "voice_provider_connected_evidence",
          eventHash: "fanum-provider-connected-v1",
          payload: { observedAt: params.observedAt },
        }],
        skipDuplicates: true,
      })
      return true
    }))
    if (recorded) return "recorded"
  } catch (error) {
    if (error instanceof VoiceSessionTerminalConflictError) return "conflict"
    throw error
  }

  const refreshed = await runWithTenant(params.organizationId, () => prisma.voiceCallSession.findFirst({
    where: {
      id: params.session.id,
      organizationId: params.organizationId,
      provider: "asterisk",
      providerCallId: params.callId,
      callLog: {
        is: {
          id: params.session.callLog.id,
          organizationId: params.organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: params.callId,
        },
      },
    },
    select: {
      outcome: true,
      callLog: { select: { providerOutcome: true, conversationOutcome: true } },
    },
  }))
  return refreshed?.outcome === "connected"
    && refreshed.callLog?.providerOutcome === null
    && refreshed.callLog.conversationOutcome === AI_CONNECTED_PENDING_RESULT
    ? "existing"
    : refreshed?.callLog?.providerOutcome === "connected"
      ? "existing"
      : "conflict"
}

async function recordProviderUnknownNoRedialEvidence(params: {
  organizationId: string
  session: {
    id: string
    status: string
    outcome: string | null
    blockReason: string | null
    queueItem: {
      id: string
      queueId: string
      ownerUserId: string
      status: string
    } | null
    callLog: {
      id: string
      providerOutcome: string | null
      conversationOutcome: string | null
    }
  }
  callId: string
  observedAt: string
}): Promise<"recorded" | "existing" | "conflict"> {
  if (params.session.callLog.providerOutcome !== null) return "existing"
  if (
    params.session.outcome === "connected"
    && params.session.callLog.conversationOutcome === AI_CONNECTED_PENDING_RESULT
  ) return "existing"
  if (
    params.session.status === "dispatch_uncertain"
    && params.session.outcome === null
    && params.session.blockReason === PROVIDER_UNKNOWN_NO_REDIAL
    && params.session.callLog.conversationOutcome === PROVIDER_UNKNOWN_NO_REDIAL
  ) return "existing"
  if (params.session.outcome === "operator_closed_unknown_no_redial") return "existing"
  if (params.session.outcome !== null) return "conflict"

  const now = new Date()
  try {
    const recorded = await runWithTenant(params.organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const callChanged = await tx.callLog.updateMany({
        where: {
          id: params.session.callLog.id,
          organizationId: params.organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: params.callId,
          providerOutcome: null,
          conversationOutcome: null,
        },
        data: {
          status: "dispatch-uncertain",
          conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL,
          endedAt: now,
        },
      })
      if (callChanged.count !== 1) return false

      const sessionChanged = await tx.voiceCallSession.updateMany({
        where: {
          id: params.session.id,
          organizationId: params.organizationId,
          callLogId: params.session.callLog.id,
          providerCallId: params.callId,
          status: { in: ["dispatching", "dispatch_uncertain"] },
          outcome: null,
          blockReason: null,
          endedAt: null,
          activeOrganizationKey: params.organizationId,
        },
        data: {
          status: "dispatch_uncertain",
          blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
          leaseUntil: null,
          activeOrganizationKey: null,
          endedAt: now,
        },
      })
      if (sessionChanged.count !== 1) throw new VoiceSessionTerminalConflictError()

      if (params.session.queueItem) {
        const itemChanged = await tx.voiceCallQueueItem.updateMany({
          where: {
            id: params.session.queueItem.id,
            organizationId: params.organizationId,
            queueId: params.session.queueItem.queueId,
            ownerUserId: params.session.queueItem.ownerUserId,
            voiceCallSessionId: params.session.id,
            status: { in: ["dispatching", "waiting_terminal", "dispatch_uncertain"] },
          },
          data: {
            status: "dispatch_uncertain",
            outcome: null,
            blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
            activeOrganizationKey: null,
            activeOwnerKey: null,
            leaseToken: null,
            leaseUntil: null,
            endedAt: now,
          },
        })
        if (itemChanged.count !== 1) throw new VoiceSessionTerminalConflictError()
        await tx.voiceCallQueue.updateMany({
          where: {
            id: params.session.queueItem.queueId,
            organizationId: params.organizationId,
            ownerUserId: params.session.queueItem.ownerUserId,
            status: { in: ["running", "paused"] },
          },
          data: { status: "attention_required" },
        })
      }

      await tx.callEvent.createMany({
        data: [{
          organizationId: params.organizationId,
          callLogId: params.session.callLog.id,
          provider: "asterisk",
          providerCallId: params.callId,
          eventType: "voice_provider_unknown_no_redial",
          eventHash: "fanum-provider-unknown-no-redial-v1",
          payload: { observedAt: params.observedAt },
        }],
        skipDuplicates: true,
      })
      return true
    }))
    if (recorded) return "recorded"
  } catch (error) {
    if (error instanceof VoiceSessionTerminalConflictError) return "conflict"
    throw error
  }

  const refreshed = await runWithTenant(params.organizationId, () => prisma.voiceCallSession.findFirst({
    where: {
      id: params.session.id,
      organizationId: params.organizationId,
      provider: "asterisk",
      providerCallId: params.callId,
      callLog: {
        is: {
          id: params.session.callLog.id,
          organizationId: params.organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: params.callId,
        },
      },
    },
    select: {
      status: true,
      outcome: true,
      blockReason: true,
      callLog: { select: { providerOutcome: true, conversationOutcome: true } },
    },
  }))
  if (refreshed?.callLog?.providerOutcome !== null) return "existing"
  if (
    refreshed?.outcome === "connected"
    && refreshed.callLog?.conversationOutcome === AI_CONNECTED_PENDING_RESULT
  ) return "existing"
  return refreshed?.status === "dispatch_uncertain"
    && refreshed.outcome === null
    && refreshed.blockReason === PROVIDER_UNKNOWN_NO_REDIAL
    && refreshed.callLog?.conversationOutcome === PROVIDER_UNKNOWN_NO_REDIAL
    ? "existing"
    : "conflict"
}

/** PBX-only terminal call-result endpoint. Tenant and call ownership are server-derived. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID
  if (!organizationId) return NextResponse.json({ error: "Voice agent is not configured" }, { status: 503 })

  const bodyText = await request.text()
  if (Buffer.byteLength(bodyText, "utf8") > 250_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }
  let body: unknown = null
  try {
    body = JSON.parse(bodyText)
  } catch {
    // The generic validation response below deliberately avoids parser details.
  }
  const parsed = voiceAgentCallResultSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid call result" }, { status: 400 })

  const session = await runWithTenant(organizationId, () => prisma.voiceCallSession.findFirst({
    where: {
      organizationId,
      provider: "asterisk",
      providerCallId: parsed.data.callId,
      callLog: {
        is: {
          organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: parsed.data.callId,
        },
      },
    },
    select: {
      id: true,
      status: true,
      outcome: true,
      blockReason: true,
      queueItem: {
        select: {
          id: true,
          queueId: true,
          ownerUserId: true,
          status: true,
        },
      },
      callLog: {
        select: {
          id: true,
          insightsAt: true,
          providerOutcome: true,
          transcription: true,
          duration: true,
          conversationOutcome: true,
        },
      },
    },
  }))
  if (!session?.callLog) return NextResponse.json({ error: "Call not found" }, { status: 404 })
  const call = session.callLog

  if ("protocol" in parsed.data) {
    const evidence = parsed.data.protocol === "fanum-provider-connected-v1"
      ? await recordProviderConnectedEvidence({
          organizationId,
          session,
          callId: parsed.data.callId,
          observedAt: parsed.data.observedAt,
        })
      : await recordProviderUnknownNoRedialEvidence({
          organizationId,
          session,
          callId: parsed.data.callId,
          observedAt: parsed.data.observedAt,
        })
    if (evidence === "conflict") return conflictingTerminalResult()
    return NextResponse.json({
      success: true,
      analysisStatus: parsed.data.protocol === "fanum-provider-connected-v1"
        ? "provider_connected_pending_result"
        : PROVIDER_UNKNOWN_NO_REDIAL,
    })
  }

  const providerOutcome: VoiceAgentProviderOutcome = parsed.data.providerOutcome ?? "connected"
  if (
    call.providerOutcome === null
    && session.outcome !== null
    && session.outcome !== "operator_closed_unknown_no_redial"
    && session.outcome !== providerOutcome
  ) {
    // The durable PBX registry may have won the race before this signed
    // enrichment callback. Its immutable terminal outcome remains the
    // provider authority; a contradictory callback cannot regress it.
    return conflictingTerminalResult()
  }
  const wasAnswered = providerOutcome === "connected"
  const customerSpoke = parsed.data.turns.some((turn) => turn.role === "customer")
  const conversationOutcome = wasAnswered
    ? (customerSpoke ? "customer_spoke" : "no_customer_speech")
    : providerOutcome
  const canonicalTranscript = parsed.data.turns.length > 0
    ? formatVoiceTranscript(parsed.data.turns)
    : null

  const now = new Date()
  const callLogData: Prisma.CallLogUpdateManyMutationInput = {
    status: callLogStatusByOutcome[providerOutcome],
    providerOutcome,
    wasAnswered,
    conversationOutcome,
    duration: parsed.data.durationSeconds,
    endedAt: now,
  }
  if (canonicalTranscript !== null) {
    callLogData.transcription = canonicalTranscript
  }
  // Written only when the PBX actually reported them. A build that predates the
  // fields must leave whatever is already stored alone rather than blanking it.
  if (parsed.data.agentMidUtterance !== undefined) {
    callLogData.agentMidUtterance = parsed.data.agentMidUtterance
  }
  if (parsed.data.recoveryAttempts !== undefined) {
    callLogData.recoveryAttempts = parsed.data.recoveryAttempts
  }
  // Raw dial evidence stays out of every terminal-conflict comparison: an old
  // PBX build retrying the same result without these fields must still match.
  if (parsed.data.dialStatus !== undefined) {
    callLogData.providerDialStatus = parsed.data.dialStatus
  }
  if (parsed.data.hangupCause !== undefined) {
    callLogData.providerHangupCause = parsed.data.hangupCause
  }

  let insightsAt = call.insightsAt
  let correctedInsideTerminalClaim = false
  const enrichesRegistryTerminal = providerOutcome !== "connected"
    && call.providerOutcome === providerOutcome
    && call.conversationOutcome === providerOutcome
    && call.duration === null
    && call.transcription === null
    && session.outcome === providerOutcome
  if (enrichesRegistryTerminal) {
    // A durable registry terminal is sufficient to complete call history when
    // the PBX callback is lost. If the exact callback later arrives, enrich
    // duration/transcript through a one-way CAS without reopening any fence.
    const enriched = await runWithTenant(organizationId, () => prisma.callLog.updateMany({
      where: {
        id: call.id,
        organizationId,
        callMode: "ai",
        provider: "asterisk",
        providerCallId: parsed.data.callId,
        providerOutcome,
        conversationOutcome: providerOutcome,
        duration: null,
        transcription: null,
      },
      data: callLogData,
    }))
    if (enriched.count === 0) {
      const refreshed = await runWithTenant(organizationId, () => prisma.callLog.findFirst({
        where: {
          id: call.id,
          organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: parsed.data.callId,
        },
        select: {
          providerOutcome: true,
          insightsAt: true,
          transcription: true,
          duration: true,
          conversationOutcome: true,
        },
      }))
      if (
        !refreshed
        || !matchesPersistedTerminalResult({
          persisted: refreshed,
          providerOutcome,
          conversationOutcome,
          durationSeconds: parsed.data.durationSeconds,
          transcription: canonicalTranscript,
        })
      ) {
        return conflictingTerminalResult()
      }
      insightsAt = refreshed.insightsAt
    }
  } else if (!call.providerOutcome) {
    let recorded: boolean
    try {
      recorded = await runWithTenant(organizationId, () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // A terminal outcome is claimed exactly once. Duplicate or conflicting
        // callbacks cannot regress an already-recorded provider outcome.
        const updated = await tx.callLog.updateMany({
          where: {
            id: call.id,
            organizationId,
            callMode: "ai",
            provider: "asterisk",
            providerCallId: parsed.data.callId,
            providerOutcome: null,
          },
          data: callLogData,
        })
        if (updated.count === 0) return false

        const sessionUpdated = await tx.voiceCallSession.updateMany({
          where: {
            id: session.id,
            organizationId,
            callLogId: call.id,
            providerCallId: parsed.data.callId,
            OR: [
              { outcome: null },
              { outcome: "operator_closed_unknown_no_redial" },
              { outcome: providerOutcome },
            ],
          },
          data: {
            status: voiceSessionStatusByOutcome[providerOutcome],
            outcome: providerOutcome,
            answeredAt: wasAnswered ? now : null,
            endedAt: now,
            leaseUntil: null,
            activeOrganizationKey: null,
            activeLeadKey: null,
            activePhoneKey: null,
          },
        })
        if (sessionUpdated.count !== 1) throw new VoiceSessionTerminalConflictError()

        await correctLateResolvedQueueItem({
          db: tx,
          organizationId,
          voiceCallSessionId: session.id,
          queueItem: session.queueItem,
          providerOutcome,
          endedAt: now,
        })
        return true
      }))
    } catch (error) {
      if (error instanceof VoiceSessionTerminalConflictError) return conflictingTerminalResult()
      throw error
    }
    correctedInsideTerminalClaim = recorded

    if (!recorded) {
      const refreshed = await runWithTenant(organizationId, () => prisma.callLog.findFirst({
        where: {
          id: call.id,
          organizationId,
          callMode: "ai",
          provider: "asterisk",
          providerCallId: parsed.data.callId,
        },
        select: {
          providerOutcome: true,
          insightsAt: true,
          transcription: true,
          duration: true,
          conversationOutcome: true,
        },
      }))
      if (!refreshed || refreshed.providerOutcome !== providerOutcome) {
        return NextResponse.json({ success: true, analysisStatus: "existing" })
      }
      insightsAt = refreshed.insightsAt
      if (
        !insightsAt
        && !matchesPersistedTerminalResult({
          persisted: refreshed,
          providerOutcome,
          conversationOutcome,
          durationSeconds: parsed.data.durationSeconds,
          transcription: canonicalTranscript,
        })
      ) {
        return conflictingTerminalResult()
      }
    }
  } else if (call.providerOutcome !== providerOutcome) {
    return NextResponse.json({ success: true, analysisStatus: "existing" })
  } else if (
    !call.insightsAt
    && !matchesPersistedTerminalResult({
      persisted: call,
      providerOutcome,
      conversationOutcome,
      durationSeconds: parsed.data.durationSeconds,
      transcription: canonicalTranscript,
    })
  ) {
    return conflictingTerminalResult()
  }

  // A racing or retried callback may find the CallLog terminal result already
  // committed. Repair the exact manager-resolved item in that path as well;
  // the predicate makes this a no-op for every other queue item.
  if (!correctedInsideTerminalClaim) {
    await runWithTenant(organizationId, () => correctLateResolvedQueueItem({
      db: prisma,
      organizationId,
      voiceCallSessionId: session.id,
      queueItem: session.queueItem,
      providerOutcome,
      endedAt: now,
    }))
  }

  // Provider/session terminal state is durable before any optional model call.
  // An unanswered call or an agent-only transcript is not a customer
  // conversation and must not be sent for sales analysis.
  if (!wasAnswered || !customerSpoke) {
    // If the call that just rang out was itself the automatic callback, the
    // machine is done — one dial was the whole budget — and the broken
    // conversation is handed to a person. A no-op for every ordinary call.
    await recordUnansweredCallback({ organizationId, callLogId: call.id })
    return NextResponse.json({ success: true, analysisStatus: "not_applicable" })
  }
  if (insightsAt) {
    return NextResponse.json({ success: true, analysisStatus: "existing" })
  }

  const analysisClaim = await runWithTenant(organizationId, () => acquireAnalysisClaim({
    organizationId,
    callLogId: call.id,
    providerCallId: parsed.data.callId,
    now: new Date(),
  }))
  if (analysisClaim.state === "complete") {
    return NextResponse.json({ success: true, analysisStatus: "existing" })
  }
  if (analysisClaim.state === "processing") {
    return NextResponse.json(
      { success: false, analysisStatus: "processing" },
      { status: 503, headers: { "Retry-After": "5" } },
    )
  }

  let analysisStatus: "complete" | "fallback" = "complete"
  let analysis: Awaited<ReturnType<typeof analyzeVoiceCall>>
  try {
    analysis = await analyzeVoiceCall({
      organizationId,
      callId: parsed.data.callId,
      turns: parsed.data.turns,
    })
  } catch (error) {
    analysisStatus = "fallback"
    console.error("[voice-agent] post-call analysis unavailable", {
      callIdHash: createHash("sha256").update(parsed.data.callId).digest("hex").slice(0, 12),
      errorType: error instanceof Error ? error.name : "unknown",
    })
    analysis = {
      analysis: fallbackPostCallAnalysis(parsed.data.turns),
      model: "extractive-fallback",
    }
  }

  const insightsStored = await runWithTenant(organizationId, () => prisma.callLog.updateMany({
    where: {
      id: call.id,
      organizationId,
      callMode: "ai",
      provider: "asterisk",
      providerCallId: parsed.data.callId,
      providerOutcome: "connected",
      insightsAt: null,
    },
    data: {
      insights: toConversationInsight(analysis.analysis, analysis.model) as unknown as Prisma.InputJsonValue,
      insightsAt: new Date(),
      disposition: analysis.analysis.disposition,
    },
  }))
  if (insightsStored.count === 0) {
    await runWithTenant(organizationId, () => completeAnalysisClaim({
      organizationId,
      eventId: analysisClaim.eventId,
      payload: analysisClaim.payload,
      completedAt: new Date(),
    }))
    return NextResponse.json({ success: true, analysisStatus: "existing" })
  }

  // What the customer was promised becomes a task somebody owns.
  //
  // This is the path where a real AI call is analysed — the other one, POST
  // /api/v1/calls/[id]/analyze, runs a placeholder analyser. Wiring the
  // commitment only there would have shipped a feature that never fired on the
  // calls that actually produce commitments.
  await runWithTenant(organizationId, async () => {
    const analysed = await prisma.callLog.findFirst({
      where: { id: call.id, organizationId },
      select: { leadId: true, userId: true, insights: true, createdAt: true },
    })
    if (!analysed) return
    const lead = analysed.leadId
      ? await prisma.lead.findFirst({
          where: { id: analysed.leadId, organizationId },
          select: { assignedTo: true },
        })
      : null
    await recordCallCommitment({
      organizationId,
      callId: call.id,
      leadId: analysed.leadId ?? null,
      insight: analysed.insights as ConversationInsight | null,
      callAt: new Date(),
      assigneeId: lead?.assignedTo ?? analysed.userId ?? null,
    })
  })

  await runWithTenant(organizationId, () => completeAnalysisClaim({
    organizationId,
    eventId: analysisClaim.eventId,
    payload: analysisClaim.payload,
    completedAt: new Date(),
  }))

  // The system's only self-initiated outgoing call. Placed last, after the
  // result is fully stored, so a callback can never be the reason a transcript
  // was lost. It swallows its own failures for the same reason: throwing here
  // would fail this webhook and make the PBX retry work that already succeeded.
  await maybePlaceCallback({
    organizationId,
    callLogId: call.id,
    turns: parsed.data.turns,
  })

  return NextResponse.json({ success: true, analysisStatus })
}
