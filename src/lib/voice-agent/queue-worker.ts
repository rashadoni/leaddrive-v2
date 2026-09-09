import { randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "@prisma/client"

import { evaluateBusinessHours, isValidTimeZone } from "@/lib/inbox/business-hours"
import { getVoipProvider, type AsteriskSettings } from "@/lib/voip"
import { isOutboundVoiceDispatchPaused } from "@/lib/voip/outbound-dispatch-gate"
import {
  assertOutboundVoiceDispatchAllowed,
  OutboundVoiceDispatchPausedError,
} from "@/lib/voip/outbound-dispatch-lock"
import { missingVoipFields, normalizeVoipSettings, voipFromNumber } from "@/lib/voip/configs"
import { buildPriorConnectedCallWhere } from "@/lib/voice-agent/call-history"
import { buildUnresolvedOutboundCallWhere } from "@/lib/voice-agent/unresolved-call"
import {
  lockVoiceContactPermission,
  lockVoiceLeadRow,
} from "@/lib/voice-agent/voice-permission-lock"
import {
  MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H,
  MANUAL_LEAD_AI_USER_LIMIT_24H,
  normalizeManualLeadPhone,
} from "@/lib/voice-agent/manual-lead-call"
import {
  completeVoiceQueueIfDrained,
  evaluateVoiceQueueFeature,
  isValidVoiceQueueConsentAudit,
  type VoiceQueueFeatureOptions,
  type VoiceQueueRootDb,
} from "@/lib/voice-agent/queue-service"

export const VOICE_QUEUE_DISPATCH_LEASE_MS = 10 * 60 * 1_000
export const VOICE_QUEUE_DEFER_MS = 60 * 1_000

const ACTIVE_ITEM_STATUSES = [
  "claimed",
  "dispatching",
  "waiting_terminal",
  "dispatch_uncertain",
] as const

const TERMINAL_SESSION_STATUSES = new Set([
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
  "blocked",
])

type QueueWorkerDb = VoiceQueueRootDb & Pick<PrismaClient, "businessHours">

type ClaimedQueueItem = {
  id: string
  organizationId: string
  queueId: string
  ownerUserId: string
  leadId: string
  idempotencyKey: string
  queuedPhoneKey: string
  leaseToken: string
  consentAudit: Prisma.JsonValue
}

type QueueProvider = {
  channelConfigId: string
  settings: AsteriskSettings
  fromNumber: string
}

export type VoiceQueueEligibilityBlocker =
  | "voice_queue_disabled"
  | "owner_inactive"
  | "lead_reassigned"
  | "lead_inactive"
  | "no_phone"
  | "phone_changed"
  | "voice_opt_out"
  | "connected_before"
  | "voice_calling_hours_unconfigured"
  | "outside_calling_hours"
  | "active_call_exists"
  | "provider_unavailable"
  | "user_limit_reached"
  | "organization_limit_reached"
  | "consent_audit_invalid"

export type VoiceQueueEligibilityDecision =
  | {
      eligible: true
      targetPhoneE164: string
      targetDialNumber: string
      assignedTo: string
      consentBasis: "stored" | "bulk_per_call_attestation"
      provider: QueueProvider
      policySnapshot: Prisma.InputJsonObject
    }
  | {
      eligible: false
      blocker: VoiceQueueEligibilityBlocker
      terminal: boolean
      retryAt: Date | null
      policySnapshot: Prisma.InputJsonObject
    }

export type VoiceQueueEligibilityRecheck = (params: {
  db: Prisma.TransactionClient
  item: ClaimedQueueItem
  now: Date
  featureOptions?: VoiceQueueFeatureOptions
}) => Promise<VoiceQueueEligibilityDecision>

type QueueDispatchInput = {
  providerSettings: AsteriskSettings
  targetDialNumber: string
  fromNumber: string
  providerCallId: string
}

export type VoiceQueueDispatch = (input: QueueDispatchInput) => Promise<{
  success: boolean
  callSid?: string
  failureCertainty?: "definite_rejection" | "unknown_delivery"
}>

export type VoiceQueueWorkerResult =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "waiting_terminal" }
  | { status: "terminal_reconciled" }
  | { status: "blocked"; blocker: VoiceQueueEligibilityBlocker }
  | { status: "deferred"; blocker: VoiceQueueEligibilityBlocker }
  | { status: "dispatching" }
  | { status: "provider_failed" }
  | { status: "dispatch_uncertain" }

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function selectQueueProvider(
  db: Pick<Prisma.TransactionClient, "channelConfig">,
  organizationId: string,
): Promise<QueueProvider | null> {
  const rows = await db.channelConfig.findMany({
    where: { organizationId, channelType: "voip", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      configName: true,
      phoneNumber: true,
      apiKey: true,
      settings: true,
      isActive: true,
    },
  })
  for (const row of rows) {
    const raw = jsonRecord(row.settings)
    const normalized = normalizeVoipSettings(row, organizationId)
    const mode = raw.voiceAgentMode
    if (
      raw.voiceQueueEnabled === true
      && raw.manualLeadAiCallsEnabled === true
      && raw.voiceAgentEnabled === true
      && (mode === "outbound" || mode === "both")
      && normalized?.provider === "asterisk"
      && missingVoipFields(normalized).length === 0
    ) {
      return {
        channelConfigId: row.id,
        settings: normalized,
        fromNumber: voipFromNumber(normalized),
      }
    }
  }
  return null
}

function blockedDecision(params: {
  blocker: VoiceQueueEligibilityBlocker
  terminal: boolean
  retryAt?: Date | null
  now: Date
}): VoiceQueueEligibilityDecision {
  return {
    eligible: false,
    blocker: params.blocker,
    terminal: params.terminal,
    retryAt: params.retryAt ?? null,
    policySnapshot: {
      evaluatedAt: params.now.toISOString(),
      blocker: params.blocker,
      terminal: params.terminal,
    },
  }
}

/**
 * The claim-time policy reads every mutable safety input again. Queue creation
 * is only a membership snapshot; it is never authority to call a reassigned,
 * suppressed, already-contacted, out-of-hours, or over-limit lead later.
 */
export const recheckVoiceQueueItemEligibility: VoiceQueueEligibilityRecheck = async ({
  db,
  item,
  now,
  featureOptions,
}) => {
  const feature = await evaluateVoiceQueueFeature({
    db,
    organizationId: item.organizationId,
    options: featureOptions,
  })
  if (!feature.enabled) {
    return blockedDecision({ blocker: "voice_queue_disabled", terminal: false, now })
  }
  if (!isValidVoiceQueueConsentAudit(item.consentAudit)) {
    return blockedDecision({ blocker: "consent_audit_invalid", terminal: true, now })
  }

  const [owner, lead] = await Promise.all([
    db.user.findFirst({
      where: {
        id: item.ownerUserId,
        organizationId: item.organizationId,
        isActive: true,
        role: "sales",
      },
      select: { id: true },
    }),
    db.lead.findFirst({
      where: { id: item.leadId, organizationId: item.organizationId },
      select: { id: true, assignedTo: true, status: true, phone: true },
    }),
  ])
  if (!owner) {
    return blockedDecision({ blocker: "owner_inactive", terminal: true, now })
  }
  if (!lead || lead.assignedTo !== item.ownerUserId) {
    return blockedDecision({ blocker: "lead_reassigned", terminal: true, now })
  }
  if (["converted", "lost"].includes(lead.status.toLowerCase())) {
    return blockedDecision({ blocker: "lead_inactive", terminal: true, now })
  }
  const normalizedPhone = normalizeManualLeadPhone(lead.phone)
  if (!normalizedPhone) {
    return blockedDecision({ blocker: "no_phone", terminal: true, now })
  }
  if (normalizedPhone.e164 !== item.queuedPhoneKey) {
    return blockedDecision({ blocker: "phone_changed", terminal: true, now })
  }

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000)
  const [
    provider,
    voiceHours,
    activeSession,
    unresolvedHumanCall,
    suppression,
    consents,
    priorConversation,
    userAttemptCount,
    organizationAttemptCount,
  ] = await Promise.all([
    selectQueueProvider(db, item.organizationId),
    db.businessHours.findFirst({
      where: { organizationId: item.organizationId, channelType: "voice" },
      select: {
        timezone: true,
        schedule: true,
        holidays: true,
        isActive: true,
      },
    }),
    db.voiceCallSession.findFirst({
      where: {
        organizationId: item.organizationId,
        OR: [
          { activeOrganizationKey: item.organizationId },
          { activeLeadKey: { not: null } },
          { activePhoneKey: { not: null } },
        ],
      },
      select: { id: true },
    }),
    db.callLog.findFirst({
      where: buildUnresolvedOutboundCallWhere({
        organizationId: item.organizationId,
        targetPhoneE164: normalizedPhone.e164,
        callModes: ["human"],
      }),
      select: { id: true },
    }),
    db.voiceSuppression.findFirst({
      where: {
        organizationId: item.organizationId,
        phoneE164: normalizedPhone.e164,
        scope: { in: ["sales", "all"] },
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    }),
    db.voiceConsent.findMany({
      where: {
        organizationId: item.organizationId,
        phoneE164: normalizedPhone.e164,
        scope: { in: ["sales", "all"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { status: true },
    }),
    db.callLog.findFirst({
      where: buildPriorConnectedCallWhere({
        organizationId: item.organizationId,
        leadId: item.leadId,
        targetPhoneE164: normalizedPhone.e164,
      }),
      select: { id: true },
    }),
    db.voiceCallSession.count({
      where: {
        organizationId: item.organizationId,
        requestedByUserId: item.ownerUserId,
        createdAt: { gte: since },
      },
    }),
    db.voiceCallSession.count({
      where: { organizationId: item.organizationId, createdAt: { gte: since } },
    }),
  ])

  if (!provider) {
    return blockedDecision({
      blocker: "provider_unavailable",
      terminal: false,
      retryAt: new Date(now.getTime() + VOICE_QUEUE_DEFER_MS),
      now,
    })
  }
  if (activeSession || unresolvedHumanCall) {
    return blockedDecision({
      blocker: "active_call_exists",
      terminal: false,
      retryAt: new Date(now.getTime() + VOICE_QUEUE_DEFER_MS),
      now,
    })
  }
  if (suppression || consents.some((consent) => consent.status === "blocked")) {
    return blockedDecision({ blocker: "voice_opt_out", terminal: true, now })
  }
  if (priorConversation) {
    return blockedDecision({ blocker: "connected_before", terminal: true, now })
  }
  if (userAttemptCount >= MANUAL_LEAD_AI_USER_LIMIT_24H) {
    return blockedDecision({
      blocker: "user_limit_reached",
      terminal: false,
      retryAt: new Date(now.getTime() + VOICE_QUEUE_DEFER_MS),
      now,
    })
  }
  if (organizationAttemptCount >= MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H) {
    return blockedDecision({
      blocker: "organization_limit_reached",
      terminal: false,
      retryAt: new Date(now.getTime() + VOICE_QUEUE_DEFER_MS),
      now,
    })
  }

  const validTimezone = Boolean(
    voiceHours?.isActive === true
    && voiceHours.timezone
    && isValidTimeZone(voiceHours.timezone),
  )
  if (!voiceHours || !validTimezone) {
    return blockedDecision({ blocker: "voice_calling_hours_unconfigured", terminal: false, now })
  }
  const schedule = evaluateBusinessHours(voiceHours, now)
  if (
    !schedule.open
    || (schedule.reason !== "inside_hours" && schedule.reason !== "holiday_hours")
  ) {
    return blockedDecision({
      blocker: "outside_calling_hours",
      terminal: false,
      retryAt: new Date(now.getTime() + VOICE_QUEUE_DEFER_MS),
      now,
    })
  }

  const storedConsent = consents.some((consent) => consent.status === "allowed")
  return {
    eligible: true,
    targetPhoneE164: normalizedPhone.e164,
    targetDialNumber: normalizedPhone.dialNumber,
    assignedTo: lead.assignedTo,
    consentBasis: storedConsent ? "stored" : "bulk_per_call_attestation",
    provider,
    policySnapshot: {
      evaluatedAt: now.toISOString(),
      queuePolicy: "sequential_selected_v1",
      assignmentRechecked: true,
      suppressionRechecked: true,
      businessHoursOpen: true,
      businessHoursTimezone: voiceHours.timezone,
      userAttempts24h: userAttemptCount,
      organizationAttempts24h: organizationAttemptCount,
      consentBasis: storedConsent ? "stored" : "bulk_per_call_attestation",
    },
  }
}

function terminalItemStatus(session: { status: string; outcome: string | null }): {
  status: "completed" | "no_answer" | "busy" | "failed" | "cancelled" | "blocked"
  outcome: "connected" | "no_answer" | "busy" | "failed" | "cancelled" | "blocked"
} | null {
  if (!TERMINAL_SESSION_STATUSES.has(session.status)) return null
  switch (session.status) {
    case "completed":
      return { status: "completed", outcome: "connected" }
    case "no_answer":
      return { status: "no_answer", outcome: "no_answer" }
    case "busy":
      return { status: "busy", outcome: "busy" }
    case "cancelled":
      return { status: "cancelled", outcome: "cancelled" }
    case "blocked":
      return { status: "blocked", outcome: "blocked" }
    default:
      return { status: "failed", outcome: "failed" }
  }
}

async function reconcileActiveItem(params: {
  db: QueueWorkerDb
  organizationId: string
  now: Date
}): Promise<VoiceQueueWorkerResult | null> {
  const item = await params.db.voiceCallQueueItem.findFirst({
    where: {
      organizationId: params.organizationId,
      status: { in: [...ACTIVE_ITEM_STATUSES] },
      activeOrganizationKey: params.organizationId,
    },
    select: {
      id: true,
      queueId: true,
      status: true,
      leaseUntil: true,
      voiceCallSession: {
        select: { id: true, status: true, outcome: true, endedAt: true },
      },
    },
  })
  if (!item) return null

  const terminal = item.voiceCallSession
    ? terminalItemStatus(item.voiceCallSession)
    : null
  if (terminal && item.voiceCallSession?.endedAt) {
    await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.voiceCallQueueItem.updateMany({
        where: {
          id: item.id,
          organizationId: params.organizationId,
          status: { in: [...ACTIVE_ITEM_STATUSES] },
          voiceCallSessionId: item.voiceCallSession?.id,
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
          endedAt: item.voiceCallSession?.endedAt,
        },
      })
      if (changed.count === 1) {
        const completed = await completeVoiceQueueIfDrained({
          db: tx,
          organizationId: params.organizationId,
          queueId: item.queueId,
          now: params.now,
        })
        if (!completed) {
          // A late terminal callback resolves the uncertain item but never
          // silently restarts the remaining batch. An operator must explicitly
          // resume the now-paused queue after reviewing the prior uncertainty.
          await tx.voiceCallQueue.updateMany({
            where: {
              id: item.queueId,
              organizationId: params.organizationId,
              status: "attention_required",
            },
            data: { status: "paused", pausedAt: params.now },
          })
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { status: "terminal_reconciled" }
  }

  if (
    item.status === "dispatch_uncertain"
    || item.voiceCallSession?.status === "dispatch_uncertain"
    || (
      (item.status === "dispatching" || item.status === "waiting_terminal")
      && item.leaseUntil !== null
      && item.leaseUntil <= params.now
    )
  ) {
    await params.db.$transaction([
      params.db.voiceCallQueueItem.updateMany({
        where: {
          id: item.id,
          organizationId: params.organizationId,
          status: { in: ["dispatching", "waiting_terminal", "dispatch_uncertain"] },
        },
        data: { status: "dispatch_uncertain", leaseToken: null, leaseUntil: null },
      }),
      params.db.voiceCallQueue.updateMany({
        where: {
          id: item.queueId,
          organizationId: params.organizationId,
          status: { in: ["running", "paused"] },
        },
        data: { status: "attention_required" },
      }),
      ...(item.voiceCallSession
        ? [params.db.voiceCallSession.updateMany({
            where: {
              id: item.voiceCallSession.id,
              organizationId: params.organizationId,
              endedAt: null,
              status: { in: ["prepared", "dispatching"] },
            },
            data: { status: "dispatch_uncertain" },
          })]
        : []),
    ])
    return { status: "dispatch_uncertain" }
  }

  return { status: "waiting_terminal" }
}

type PreparedQueueCall = {
  itemId: string
  queueId: string
  sessionId: string
  callLogId: string
  providerCallId: string
  targetDialNumber: string
  fromNumber: string
  providerSettings: AsteriskSettings
}

async function prepareNextQueueCall(params: {
  db: QueueWorkerDb
  organizationId: string
  now: Date
  featureOptions?: VoiceQueueFeatureOptions
  recheckEligibility: VoiceQueueEligibilityRecheck
}): Promise<
  | { kind: "idle" }
  | { kind: "blocked"; blocker: VoiceQueueEligibilityBlocker; queueId: string }
  | { kind: "deferred"; blocker: VoiceQueueEligibilityBlocker; queueId: string }
  | { kind: "prepared"; call: PreparedQueueCall }
> {
  try {
    return await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const queue = await tx.voiceCallQueue.findFirst({
        where: {
          organizationId: params.organizationId,
          status: "running",
          activeOrganizationKey: params.organizationId,
        },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        select: { id: true, ownerUserId: true, consentAudit: true },
      })
      if (!queue) return { kind: "idle" } as const

      const item = await tx.voiceCallQueueItem.findFirst({
        where: {
          organizationId: params.organizationId,
          queueId: queue.id,
          ownerUserId: queue.ownerUserId,
          status: "pending",
          OR: [{ availableAt: null }, { availableAt: { lte: params.now } }],
        },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          queueId: true,
          ownerUserId: true,
          leadId: true,
          idempotencyKey: true,
          queuedPhoneKey: true,
        },
      })
      if (!item) return { kind: "idle" } as const
      const queuedPhoneKey = item.queuedPhoneKey
      if (!queuedPhoneKey) throw new Error("voice_queue_item_phone_fence_missing")
      await assertOutboundVoiceDispatchAllowed({
        tx,
        organizationId: params.organizationId,
      })
      await lockVoiceLeadRow(tx, params.organizationId, item.leadId)
      await lockVoiceContactPermission(tx, params.organizationId, queuedPhoneKey)

      const leaseToken = randomUUID()
      const leaseUntil = new Date(params.now.getTime() + VOICE_QUEUE_DISPATCH_LEASE_MS)
      const claimed = await tx.voiceCallQueueItem.updateMany({
        where: {
          id: item.id,
          organizationId: params.organizationId,
          queueId: queue.id,
          ownerUserId: queue.ownerUserId,
          status: "pending",
        },
        data: {
          status: "claimed",
          activeOrganizationKey: params.organizationId,
          activeOwnerKey: `${params.organizationId}:${queue.ownerUserId}`,
          leaseToken,
          leaseUntil,
          claimedAt: params.now,
          blockReason: null,
          availableAt: null,
        },
      })
      if (claimed.count !== 1) return { kind: "idle" } as const

      const claimedItem: ClaimedQueueItem = {
        ...item,
        organizationId: params.organizationId,
        leaseToken,
        queuedPhoneKey,
        consentAudit: queue.consentAudit,
      }
      const eligibility = await params.recheckEligibility({
        db: tx,
        item: claimedItem,
        now: params.now,
        featureOptions: params.featureOptions,
      })
      if (!eligibility.eligible) {
        await tx.voiceCallQueueItem.updateMany({
          where: {
            id: item.id,
            organizationId: params.organizationId,
            status: "claimed",
            leaseToken,
          },
          data: eligibility.terminal
            ? {
                status: "blocked",
                outcome: "blocked",
                blockReason: eligibility.blocker,
                eligibilitySnapshot: eligibility.policySnapshot,
                queuedLeadKey: null,
                queuedPhoneKey: null,
                activeOrganizationKey: null,
                activeOwnerKey: null,
                leaseToken: null,
                leaseUntil: null,
                endedAt: params.now,
              }
            : {
                status: "pending",
                blockReason: eligibility.blocker,
                eligibilitySnapshot: eligibility.policySnapshot,
                activeOrganizationKey: null,
                activeOwnerKey: null,
                leaseToken: null,
                leaseUntil: null,
                availableAt: eligibility.retryAt,
              },
        })
        return eligibility.terminal
          ? { kind: "blocked", blocker: eligibility.blocker, queueId: queue.id } as const
          : { kind: "deferred", blocker: eligibility.blocker, queueId: queue.id } as const
      }

      const providerCallId = randomUUID()
      const consentAudit: Prisma.InputJsonObject = {
        scope: "sales",
        consentConfirmed: true,
        basis: eligibility.consentBasis,
        attestedByUserId: jsonRecord(queue.consentAudit).attestedByUserId as string,
        attestedAt: jsonRecord(queue.consentAudit).attestedAt as string,
        queueId: queue.id,
        queueItemId: item.id,
      }
      const callLog = await tx.callLog.create({
        data: {
          organizationId: params.organizationId,
          direction: "outbound",
          fromNumber: eligibility.provider.fromNumber,
          toNumber: eligibility.targetPhoneE164,
          targetPhoneE164: eligibility.targetPhoneE164,
          status: "prepared",
          provider: "asterisk",
          providerCallId,
          callSid: providerCallId,
          callMode: "ai",
          wasAnswered: false,
          channelConfigId: eligibility.provider.channelConfigId,
          leadId: item.leadId,
          userId: item.ownerUserId,
          idempotencyKey: item.idempotencyKey,
          consentAudit,
        },
        select: { id: true },
      })
      const session = await tx.voiceCallSession.create({
        data: {
          organizationId: params.organizationId,
          activeOrganizationKey: params.organizationId,
          leadId: item.leadId,
          requestedByUserId: item.ownerUserId,
          assignedToSnapshot: eligibility.assignedTo,
          idempotencyKey: item.idempotencyKey,
          activeLeadKey: item.leadId,
          activePhoneKey: eligibility.targetPhoneE164,
          targetPhoneE164: eligibility.targetPhoneE164,
          channelConfigId: eligibility.provider.channelConfigId,
          provider: "asterisk",
          providerCallId,
          callLogId: callLog.id,
          status: "dispatching",
          policySnapshot: eligibility.policySnapshot,
          leaseUntil,
          startedAt: params.now,
        },
        select: { id: true },
      })
      const linked = await tx.voiceCallQueueItem.updateMany({
        where: {
          id: item.id,
          organizationId: params.organizationId,
          status: "claimed",
          leaseToken,
        },
        data: {
          status: "dispatching",
          voiceCallSessionId: session.id,
          eligibilitySnapshot: eligibility.policySnapshot,
          startedAt: params.now,
        },
      })
      if (linked.count !== 1) throw new Error("voice_queue_claim_lost")
      return {
        kind: "prepared",
        call: {
          itemId: item.id,
          queueId: item.queueId,
          sessionId: session.id,
          callLogId: callLog.id,
          providerCallId,
          targetDialNumber: eligibility.targetDialNumber,
          fromNumber: eligibility.provider.fromNumber,
          providerSettings: eligibility.provider.settings,
        },
      } as const
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === "P2002" || error.code === "P2034")
    ) {
      return { kind: "deferred", blocker: "active_call_exists", queueId: "" }
    }
    throw error
  }
}

async function defaultDispatch(input: QueueDispatchInput) {
  return getVoipProvider(input.providerSettings).initiateCall({
    toNumber: input.targetDialNumber,
    fromNumber: input.fromNumber,
    voiceAgent: true,
    correlationId: input.providerCallId,
  })
}

/** Process at most one state transition for one organisation. */
export async function processSequentialVoiceQueueOrganization(params: {
  db: QueueWorkerDb
  organizationId: string
  now?: Date
  featureOptions?: VoiceQueueFeatureOptions
  recheckEligibility?: VoiceQueueEligibilityRecheck
  dispatch?: VoiceQueueDispatch
}): Promise<VoiceQueueWorkerResult> {
  const now = params.now ?? new Date()
  // Existing provider/session bookkeeping must finish even after an admin
  // disables future automation. The feature gate below protects only a new
  // claim/dispatch, never durable terminal reconciliation.
  const reconciled = await reconcileActiveItem({
    db: params.db,
    organizationId: params.organizationId,
    now,
  })
  if (reconciled) return reconciled

  const feature = await evaluateVoiceQueueFeature({
    db: params.db,
    organizationId: params.organizationId,
    options: params.featureOptions,
  })
  if (!feature.enabled) return { status: "disabled" }
  if (isOutboundVoiceDispatchPaused(params.organizationId)) return { status: "disabled" }

  let prepared: Awaited<ReturnType<typeof prepareNextQueueCall>>
  try {
    prepared = await prepareNextQueueCall({
      db: params.db,
      organizationId: params.organizationId,
      now,
      featureOptions: params.featureOptions,
      recheckEligibility: params.recheckEligibility ?? recheckVoiceQueueItemEligibility,
    })
  } catch (error) {
    if (error instanceof OutboundVoiceDispatchPausedError) return { status: "disabled" }
    throw error
  }
  if (prepared.kind === "idle") {
    const queue = await params.db.voiceCallQueue.findFirst({
      where: {
        organizationId: params.organizationId,
        status: "running",
        activeOrganizationKey: params.organizationId,
      },
      select: { id: true },
    })
    if (queue) {
      await completeVoiceQueueIfDrained({
        db: params.db,
        organizationId: params.organizationId,
        queueId: queue.id,
        now,
      })
    }
    return { status: "idle" }
  }
  if (prepared.kind === "blocked") {
    await completeVoiceQueueIfDrained({
      db: params.db,
      organizationId: params.organizationId,
      queueId: prepared.queueId,
      now,
    })
    return { status: "blocked", blocker: prepared.blocker }
  }
  if (prepared.kind === "deferred") {
    return { status: "deferred", blocker: prepared.blocker }
  }

  let dispatchResult: Awaited<ReturnType<VoiceQueueDispatch>>
  try {
    dispatchResult = await (params.dispatch ?? defaultDispatch)({
      providerSettings: prepared.call.providerSettings,
      targetDialNumber: prepared.call.targetDialNumber,
      fromNumber: prepared.call.fromNumber,
      providerCallId: prepared.call.providerCallId,
    })
  } catch {
    dispatchResult = { success: false, failureCertainty: "unknown_delivery" }
  }

  const accepted = dispatchResult.success === true
    && dispatchResult.callSid === prepared.call.providerCallId
  if (accepted) {
    await params.db.$transaction([
      params.db.callLog.updateMany({
        where: {
          id: prepared.call.callLogId,
          organizationId: params.organizationId,
          providerOutcome: null,
        },
        data: { status: "initiated", startedAt: now },
      }),
      params.db.voiceCallQueueItem.updateMany({
        where: {
          id: prepared.call.itemId,
          organizationId: params.organizationId,
          status: "dispatching",
          voiceCallSessionId: prepared.call.sessionId,
        },
        // Keep the bounded lease while waiting for the terminal callback. If
        // it expires, reconciliation moves the item to attention_required;
        // it never claims the next lead or auto-redials.
        data: { status: "waiting_terminal" },
      }),
    ])
    return { status: "dispatching" }
  }

  if (!dispatchResult.success && dispatchResult.failureCertainty === "definite_rejection") {
    const endedAt = new Date()
    await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.voiceCallSession.updateMany({
        where: {
          id: prepared.call.sessionId,
          organizationId: params.organizationId,
          status: "dispatching",
        },
        data: {
          status: "failed",
          outcome: "failed",
          activeOrganizationKey: null,
          activeLeadKey: null,
          activePhoneKey: null,
          leaseUntil: null,
          endedAt,
        },
      })
      await tx.callLog.updateMany({
        where: {
          id: prepared.call.callLogId,
          organizationId: params.organizationId,
          providerOutcome: null,
        },
        data: {
          status: "failed",
          providerOutcome: "failed",
          conversationOutcome: "failed",
          startedAt: now,
          endedAt,
        },
      })
      await tx.voiceCallQueueItem.updateMany({
        where: {
          id: prepared.call.itemId,
          organizationId: params.organizationId,
          status: "dispatching",
          voiceCallSessionId: prepared.call.sessionId,
        },
        data: {
          status: "failed",
          outcome: "failed",
          queuedLeadKey: null,
          queuedPhoneKey: null,
          activeOrganizationKey: null,
          activeOwnerKey: null,
          leaseToken: null,
          leaseUntil: null,
          endedAt,
        },
      })
      await completeVoiceQueueIfDrained({
        db: tx,
        organizationId: params.organizationId,
        queueId: prepared.call.queueId,
        now: endedAt,
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { status: "provider_failed" }
  }

  await params.db.$transaction([
    params.db.voiceCallSession.updateMany({
      where: {
        id: prepared.call.sessionId,
        organizationId: params.organizationId,
        endedAt: null,
      },
      data: { status: "dispatch_uncertain" },
    }),
    params.db.callLog.updateMany({
      where: {
        id: prepared.call.callLogId,
        organizationId: params.organizationId,
        providerOutcome: null,
      },
      data: { status: "dispatch-uncertain", startedAt: now },
    }),
    params.db.voiceCallQueueItem.updateMany({
      where: {
        id: prepared.call.itemId,
        organizationId: params.organizationId,
        status: "dispatching",
      },
      data: { status: "dispatch_uncertain", leaseToken: null, leaseUntil: null },
    }),
    params.db.voiceCallQueue.updateMany({
      where: {
        id: prepared.call.queueId,
        organizationId: params.organizationId,
        status: { in: ["running", "paused"] },
      },
      data: { status: "attention_required" },
    }),
  ])
  return { status: "dispatch_uncertain" }
}
