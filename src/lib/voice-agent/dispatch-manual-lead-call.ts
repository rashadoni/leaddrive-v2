import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import type { AuthResult } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { getVoipProvider } from "@/lib/voip"
import {
  assertOutboundVoiceDispatchAllowed,
  OutboundVoiceDispatchPausedError,
} from "@/lib/voip/outbound-dispatch-lock"
import {
  evaluateManualLeadAiCallPolicy,
  normalizeManualLeadPhone,
  type ManualLeadAiBlocker,
  type ManualLeadAiCallPreflight,
} from "@/lib/voice-agent/manual-lead-call"
import {
  lockVoiceContactPermission,
  lockVoiceLeadRow,
} from "@/lib/voice-agent/voice-permission-lock"

/**
 * One AI call to one lead: prepare it under locks and policy, then hand it to
 * the provider exactly once.
 *
 * Moved verbatim out of `POST /api/v1/leads/[id]/ai-call` so that a second
 * caller — the demo centre, placing the one call a prospect agreed to — goes
 * through the same fences instead of a copy of them: the lead and phone
 * locks, the policy evaluation, the idempotency replay that never redials, the
 * dispatch lease, and the uncertain-dispatch handling that keeps both active
 * fences for reconciliation. The route still owns everything about HTTP
 * (credentials, permissions, the pilot check, the body) and turns the result
 * below into the same responses as before.
 */

export type ManualLeadAiCallActor = Pick<AuthResult, "orgId" | "userId" | "role">

type ExistingSession = {
  id: string
  leadId: string
  requestedByUserId: string
  callLogId: string | null
  status: string
}

export type ManualLeadAiCallReplay = Omit<ExistingSession, "callLogId"> & { callLogId: string }

export type DispatchManualLeadAiCallResult =
  | { kind: "dispatched"; sessionId: string; callLogId: string }
  | { kind: "replay"; session: ManualLeadAiCallReplay }
  | { kind: "blocked"; blockers: ManualLeadAiBlocker[]; status: 409 | 502 | 503 }
  | { kind: "paused" }
  | { kind: "not_found" }
  | { kind: "error" }

const DISPATCH_LEASE_MS = 10 * 60 * 1_000

type PreparedCall = {
  sessionId: string
  callLogId: string
  providerCallId: string
  targetDialNumber: string
  fromNumber: string
  providerSettings: Parameters<typeof getVoipProvider>[0]
  startedAt: Date
}

class InaccessibleLeadError extends Error {}

class PolicyBlockedError extends Error {
  constructor(readonly preflight: ManualLeadAiCallPreflight) {
    super("manual AI call policy blocked")
  }
}

function isUniqueOrSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034")
}

export async function findManualLeadAiCallReplay(params: {
  organizationId: string
  leadId: string
  requestedByUserId: string
  idempotencyKey: string
}): Promise<ManualLeadAiCallReplay | null> {
  const session = await prisma.voiceCallSession.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: params.organizationId,
        idempotencyKey: params.idempotencyKey,
      },
    },
    select: {
      id: true,
      leadId: true,
      requestedByUserId: true,
      callLogId: true,
      status: true,
    },
  })
  if (!session) return null
  if (
    session.leadId !== params.leadId
    || session.requestedByUserId !== params.requestedByUserId
    || !session.callLogId
  ) {
    return null
  }
  return { ...session, callLogId: session.callLogId }
}

export async function dispatchManualLeadAiCall(params: {
  auth: ManualLeadAiCallActor
  leadId: string
  idempotencyKey: string
  /** Extra, caller-specific facts recorded in the call's consent audit. */
  consentAuditExtra?: Prisma.InputJsonObject
}): Promise<DispatchManualLeadAiCallResult> {
  const { auth, leadId, idempotencyKey } = params
  const replayParams = {
    organizationId: auth.orgId,
    leadId,
    requestedByUserId: auth.userId,
    idempotencyKey: idempotencyKey,
  }
  const replay = await findManualLeadAiCallReplay(replayParams)
  if (replay) return { kind: "replay", session: replay }

  let prepared: PreparedCall
  try {
    prepared = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await assertOutboundVoiceDispatchAllowed({
        tx,
        organizationId: auth.orgId,
      })
      await lockVoiceLeadRow(tx, auth.orgId, leadId)
      const lockLead = await tx.lead.findFirst({
        where: {
          id: leadId,
          organizationId: auth.orgId,
          ...(!isManagerOrAbove(auth.role) ? { assignedTo: auth.userId } : {}),
        },
        select: { phone: true },
      })
      if (!lockLead) throw new InaccessibleLeadError()
      const lockPhone = normalizeManualLeadPhone(lockLead.phone)
      if (!lockPhone) {
        throw new PolicyBlockedError({
          eligible: false,
          blockers: ["no_phone"],
          requiresConsentConfirmation: false,
          limits: { userRemaining: 0, organizationRemaining: 0 },
        })
      }
      await lockVoiceContactPermission(tx, auth.orgId, lockPhone.e164)

      const evaluation = await evaluateManualLeadAiCallPolicy({
        db: tx,
        auth,
        leadId,
      })
      if (evaluation.inaccessible) throw new InaccessibleLeadError()
      if (evaluation.targetPhoneE164 !== lockPhone.e164) {
        throw new PolicyBlockedError({
          ...evaluation.preflight,
          eligible: false,
          blockers: ["phone_changed"],
        })
      }
      if (!evaluation.preflight.eligible) throw new PolicyBlockedError(evaluation.preflight)
      if (
        !evaluation.lead
        || !evaluation.targetPhoneE164
        || !evaluation.targetDialNumber
        || !evaluation.provider
      ) {
        throw new PolicyBlockedError({
          ...evaluation.preflight,
          eligible: false,
          blockers: ["provider_unavailable"],
        })
      }

      const now = new Date()
      const leaseUntil = new Date(now.getTime() + DISPATCH_LEASE_MS)
      const providerCallId = randomUUID()
      const consentAudit: Prisma.InputJsonObject = {
        ...(params.consentAuditExtra ?? {}),
        scope: "sales",
        consentConfirmed: true,
        basis: evaluation.consentBasis,
        attestedByUserId: auth.userId,
        attestedAt: now.toISOString(),
      }
      const callLog = await tx.callLog.create({
        data: {
          organizationId: auth.orgId,
          direction: "outbound",
          fromNumber: evaluation.provider.fromNumber,
          toNumber: evaluation.targetPhoneE164,
          targetPhoneE164: evaluation.targetPhoneE164,
          status: "dispatching",
          provider: "asterisk",
          providerCallId,
          callSid: providerCallId,
          callMode: "ai",
          wasAnswered: false,
          channelConfigId: evaluation.provider.channelConfigId,
          leadId: evaluation.lead.id,
          userId: auth.userId,
          idempotencyKey: idempotencyKey,
          consentAudit,
          startedAt: now,
        },
        select: { id: true },
      })
      const session = await tx.voiceCallSession.create({
        data: {
          organizationId: auth.orgId,
          activeOrganizationKey: auth.orgId,
          leadId: evaluation.lead.id,
          requestedByUserId: auth.userId,
          assignedToSnapshot: evaluation.lead.assignedTo,
          idempotencyKey: idempotencyKey,
          activeLeadKey: evaluation.lead.id,
          activePhoneKey: evaluation.targetPhoneE164,
          targetPhoneE164: evaluation.targetPhoneE164,
          channelConfigId: evaluation.provider.channelConfigId,
          provider: "asterisk",
          providerCallId,
          callLogId: callLog.id,
          status: "dispatching",
          policySnapshot: evaluation.policySnapshot as Prisma.InputJsonValue,
          startedAt: now,
          leaseUntil,
        },
        select: { id: true },
      })
      return {
        sessionId: session.id,
        callLogId: callLog.id,
        providerCallId,
        targetDialNumber: evaluation.targetDialNumber,
        fromNumber: evaluation.provider.fromNumber,
        providerSettings: evaluation.provider.settings,
        startedAt: now,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  } catch (error) {
    if (error instanceof OutboundVoiceDispatchPausedError) return { kind: "paused" }
    if (error instanceof InaccessibleLeadError) return { kind: "not_found" }
    if (error instanceof PolicyBlockedError) {
      return { kind: "blocked", blockers: error.preflight.blockers, status: 409 }
    }
    if (isUniqueOrSerializationConflict(error)) {
      const racedReplay = await findManualLeadAiCallReplay(replayParams)
      if (racedReplay) return { kind: "replay", session: racedReplay }
      return { kind: "blocked", blockers: ["active_call_exists"], status: 409 }
    }
    console.error("[manual-lead-ai-call] preparation failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    })
    return { kind: "error" }
  }

  const startedAt = prepared.startedAt

  let providerAccepted = false
  let definiteProviderRejection = false
  try {
    const result = await getVoipProvider(prepared.providerSettings).initiateCall({
      toNumber: prepared.targetDialNumber,
      fromNumber: prepared.fromNumber,
      voiceAgent: true,
      correlationId: prepared.providerCallId,
    })
    providerAccepted = result.success === true && result.callSid === prepared.providerCallId
    definiteProviderRejection = result.success === false
      && result.failureCertainty === "definite_rejection"
  } catch (error) {
    console.error("[manual-lead-ai-call] dispatch threw", {
      errorType: error instanceof Error ? error.name : "unknown",
    })
  }

  if (!providerAccepted) {
    if (definiteProviderRejection) {
      const endedAt = new Date()
      await prisma.$transaction([
        prisma.voiceCallSession.updateMany({
          where: {
            id: prepared.sessionId,
            organizationId: auth.orgId,
            status: "dispatching",
          },
          data: {
            status: "failed",
            outcome: "failed",
            endedAt,
            leaseUntil: null,
            activeOrganizationKey: null,
            activeLeadKey: null,
            activePhoneKey: null,
          },
        }),
        prisma.callLog.updateMany({
          where: {
            id: prepared.callLogId,
            organizationId: auth.orgId,
            providerOutcome: null,
          },
          data: {
            status: "failed",
            providerOutcome: "failed",
            wasAnswered: false,
            conversationOutcome: "failed",
            startedAt,
            endedAt,
          },
        }),
      ])
      return { kind: "blocked", blockers: ["provider_unavailable"], status: 502 }
    }

    // A timeout, transport error, or mismatched acceptance response cannot
    // prove that ARI rejected the UUID. Preserve both active fences and the
    // lease for explicit reconciliation; never auto-redial.
    await prisma.$transaction([
      prisma.voiceCallSession.updateMany({
        where: {
          id: prepared.sessionId,
          organizationId: auth.orgId,
          status: "dispatching",
        },
        data: { status: "dispatch_uncertain" },
      }),
      prisma.callLog.updateMany({
        where: {
          id: prepared.callLogId,
          organizationId: auth.orgId,
          providerOutcome: null,
        },
        data: { status: "dispatch-uncertain", startedAt },
      }),
    ])
    return { kind: "blocked", blockers: ["provider_unavailable"], status: 503 }
  }

  await prisma.callLog.updateMany({
    where: {
      id: prepared.callLogId,
      organizationId: auth.orgId,
      providerOutcome: null,
    },
    data: { status: "initiated", startedAt },
  })

  return { kind: "dispatched", sessionId: prepared.sessionId, callLogId: prepared.callLogId }
}
