import { Prisma, type PrismaClient } from "@prisma/client"

import { getVoipProvider } from "@/lib/voip"
import { missingVoipFields, normalizeVoipSettings } from "@/lib/voip/configs"
import type {
  AsteriskSettings,
  AsteriskTerminalOutcome,
  CallFinalityResult,
} from "@/lib/voip/types"
import { AI_CONNECTED_PENDING_RESULT } from "@/lib/voice-agent/call-history"
import { completeVoiceQueueIfDrained } from "@/lib/voice-agent/queue-service"

type ProviderFinalityDb = Pick<
  PrismaClient,
  | "channelConfig"
  | "voiceCallSession"
  | "voiceCallQueueItem"
  | "voiceCallQueue"
  | "callLog"
  | "callEvent"
  | "$transaction"
>

type InspectFinality = (params: {
  settings: AsteriskSettings
  providerCallId: string
}) => Promise<CallFinalityResult>

export type ProviderFinalityReconciliationResult =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "active" }
  | { status: "unknown" }
  | { status: "stale" }
  | { status: "not_accepted" }
  | { status: "terminal"; outcome: AsteriskTerminalOutcome }

export type ProviderFinalityFeatureOptions = {
  executionEnabled?: boolean
  attemptRegistryEnabled?: boolean
  pilotOrganizationId?: string | null
}

function featureEnabled(
  organizationId: string,
  options?: ProviderFinalityFeatureOptions,
): boolean {
  const executionEnabled = options?.executionEnabled
    ?? process.env.VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED === "true"
  const attemptRegistryEnabled = options?.attemptRegistryEnabled
    ?? process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED === "true"
  const pilotOrganizationId = options?.pilotOrganizationId
    ?? process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()
  return executionEnabled === true
    && attemptRegistryEnabled === true
    && Boolean(pilotOrganizationId)
    && pilotOrganizationId === organizationId
}

async function inspectAsteriskFinality(params: {
  settings: AsteriskSettings
  providerCallId: string
}): Promise<CallFinalityResult> {
  const provider = getVoipProvider(params.settings)
  if (!provider.inspectCallFinality) return { state: "unknown" }
  return provider.inspectCallFinality(params.providerCallId)
}

const SESSION_STATUS: Record<AsteriskTerminalOutcome, string> = {
  connected: "completed",
  no_answer: "no_answer",
  busy: "busy",
  failed: "failed",
  cancelled: "cancelled",
}

const ITEM_STATUS: Record<AsteriskTerminalOutcome, string> = {
  connected: "completed",
  no_answer: "no_answer",
  busy: "busy",
  failed: "failed",
  cancelled: "cancelled",
}

const CALL_STATUS: Record<AsteriskTerminalOutcome, string> = {
  connected: "completed",
  no_answer: "no-answer",
  busy: "busy",
  failed: "failed",
  cancelled: "canceled",
}

class ProviderFinalityStaleError extends Error {}

/**
 * Reconcile at most one standalone or queued uncertain Asterisk attempt.
 *
 * This path is server-gated off by default and never issues cancellation or a
 * second originate. It releases fences only from a typed, authenticated PBX
 * registry `not_accepted` tombstone or immutable `terminal` record. Every
 * other state, malformed response, 404 and transport error is fail-closed.
 */
export async function reconcileUncertainVoiceSessionFinality(params: {
  db: ProviderFinalityDb
  organizationId: string
  now?: Date
  featureOptions?: ProviderFinalityFeatureOptions
  inspectFinality?: InspectFinality
}): Promise<ProviderFinalityReconciliationResult> {
  if (!featureEnabled(params.organizationId, params.featureOptions)) {
    return { status: "disabled" }
  }

  const now = params.now ?? new Date()
  const candidate = await params.db.voiceCallSession.findFirst({
    where: {
      organizationId: params.organizationId,
      provider: "asterisk",
      status: "dispatch_uncertain",
      endedAt: null,
      activeOrganizationKey: params.organizationId,
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      providerCallId: true,
      channelConfigId: true,
      callLogId: true,
      queueItem: {
        select: {
          id: true,
          queueId: true,
          ownerUserId: true,
          status: true,
        },
      },
    },
  })
  if (!candidate) return { status: "idle" }
  if (!candidate.callLogId) return { status: "stale" }
  const callLogId = candidate.callLogId
  const queueItem = candidate.queueItem
  if (queueItem && queueItem.status !== "dispatch_uncertain") return { status: "stale" }

  const config = await params.db.channelConfig.findFirst({
    where: {
      id: candidate.channelConfigId,
      organizationId: params.organizationId,
      channelType: "voip",
      isActive: true,
    },
    select: {
      id: true,
      configName: true,
      phoneNumber: true,
      apiKey: true,
      settings: true,
      isActive: true,
    },
  })
  const settings = config ? normalizeVoipSettings(config, params.organizationId) : null
  if (!settings || settings.provider !== "asterisk" || missingVoipFields(settings).length > 0) {
    return { status: "unknown" }
  }

  let finality: CallFinalityResult
  try {
    finality = await (params.inspectFinality ?? inspectAsteriskFinality)({
      settings,
      providerCallId: candidate.providerCallId,
    })
  } catch {
    return { status: "unknown" }
  }
  if (finality.state === "accepted" || finality.state === "active") {
    return { status: "active" }
  }
  if (finality.state === "unknown") return { status: "unknown" }

  const outcome: AsteriskTerminalOutcome = finality.state === "not_accepted"
    ? "failed"
    : finality.outcome
  const resolution = finality.state === "not_accepted"
    ? "provider_not_accepted"
    : `provider_terminal_${outcome}`

  let settled: boolean
  try {
    settled = await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const sessionChanged = await tx.voiceCallSession.updateMany({
        where: {
          id: candidate.id,
          organizationId: params.organizationId,
          provider: "asterisk",
          providerCallId: candidate.providerCallId,
          callLogId,
          status: "dispatch_uncertain",
          endedAt: null,
          activeOrganizationKey: params.organizationId,
        },
        data: {
          status: SESSION_STATUS[outcome],
          outcome,
          blockReason: finality.state === "not_accepted" ? resolution : null,
          leaseUntil: null,
          activeOrganizationKey: null,
          activeLeadKey: null,
          activePhoneKey: null,
          endedAt: now,
        },
      })
      if (sessionChanged.count !== 1) return false

      if (queueItem) {
        const itemChanged = await tx.voiceCallQueueItem.updateMany({
          where: {
            id: queueItem.id,
            organizationId: params.organizationId,
            queueId: queueItem.queueId,
            ownerUserId: queueItem.ownerUserId,
            voiceCallSessionId: candidate.id,
            status: "dispatch_uncertain",
          },
          data: {
            status: ITEM_STATUS[outcome],
            outcome,
            blockReason: finality.state === "not_accepted" ? resolution : null,
            queuedLeadKey: null,
            queuedPhoneKey: null,
            activeOrganizationKey: null,
            activeOwnerKey: null,
            leaseToken: null,
            leaseUntil: null,
            endedAt: now,
          },
        })
        if (itemChanged.count !== 1) throw new ProviderFinalityStaleError()

        const completed = await completeVoiceQueueIfDrained({
          db: tx,
          organizationId: params.organizationId,
          queueId: queueItem.queueId,
          now,
        })
        if (!completed) {
          const paused = await tx.voiceCallQueue.updateMany({
            where: {
              id: queueItem.queueId,
              organizationId: params.organizationId,
              ownerUserId: queueItem.ownerUserId,
              status: "attention_required",
            },
            data: { status: "paused", pausedAt: now },
          })
          if (paused.count !== 1) {
            // A manager may cancel an attention-required queue while the PBX
            // terminal proof is in flight. Cancellation deliberately leaves
            // the uncertain item/session intact so it can still be settled,
            // but the parent queue must remain cancelled and must never be
            // reopened or paused. Treat that exact parent state as a valid
            // terminal container; every other state is a stale CAS.
            const cancelledParent = await tx.voiceCallQueue.findFirst({
              where: {
                id: queueItem.queueId,
                organizationId: params.organizationId,
                ownerUserId: queueItem.ownerUserId,
                status: "cancelled",
              },
              select: { id: true },
            })
            if (!cancelledParent) throw new ProviderFinalityStaleError()
          }
        }
      }

      await tx.callLog.updateMany({
        where: {
          id: callLogId,
          organizationId: params.organizationId,
          provider: "asterisk",
          providerCallId: candidate.providerCallId,
          providerOutcome: null,
        },
        data: finality.state === "not_accepted"
          ? {
              status: "failed",
              providerOutcome: "failed",
              conversationOutcome: "failed",
              wasAnswered: false,
              endedAt: now,
            }
          : outcome === "connected"
            ? {
                status: "completed",
                wasAnswered: true,
                conversationOutcome: AI_CONNECTED_PENDING_RESULT,
                endedAt: now,
              }
            : {
                status: CALL_STATUS[outcome],
                providerOutcome: outcome,
                conversationOutcome: outcome,
                wasAnswered: false,
                endedAt: now,
              },
      })

      await tx.callEvent.create({
        data: {
          organizationId: params.organizationId,
          callLogId,
          provider: "asterisk",
          providerCallId: candidate.providerCallId,
          eventType: "voice_provider_finality_reconciled",
          eventHash: "voice-provider-finality-reconciliation-v1",
          payload: {
            resolution,
            reconciledAt: now.toISOString(),
            providerState: finality.state,
            providerOutcome: finality.state === "terminal" ? finality.outcome : null,
            providerRevision: finality.revision,
            providerUpdatedAt: finality.updatedAt,
          },
        },
      })
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof ProviderFinalityStaleError) return { status: "stale" }
    throw error
  }

  if (!settled) return { status: "stale" }
  return finality.state === "not_accepted"
    ? { status: "not_accepted" }
    : { status: "terminal", outcome: finality.outcome }
}
