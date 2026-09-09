import { createHash, randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "@prisma/client"

import type { AuthResult } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { getVoipProvider } from "@/lib/voip"
import type { AsteriskSettings, CallFinalityResult } from "@/lib/voip/types"
import { missingVoipFields, normalizeVoipSettings } from "@/lib/voip/configs"
import {
  AI_CONNECTED_PENDING_RESULT,
  loadPriorConnectedCallHistory,
} from "@/lib/voice-agent/call-history"
import {
  MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H,
  MANUAL_LEAD_AI_USER_LIMIT_24H,
  normalizeManualLeadPhone,
} from "@/lib/voice-agent/manual-lead-call"
import { PROVIDER_UNKNOWN_NO_REDIAL } from "@/lib/voice-agent/unresolved-call"

export const VOICE_QUEUE_MAX_SELECTED_LEADS = 100
export const VOICE_QUEUE_LIST_LIMIT = 50
export const VOICE_QUEUE_UNCERTAIN_RESOLUTION_MIN_AGE_MS = 5 * 60 * 1000
export const VOICE_QUEUE_SKIP_REASONS = [
  "seller_skipped",
  "duplicate_lead",
  "not_relevant",
  "other",
] as const
export type VoiceQueueSkipReason = (typeof VOICE_QUEUE_SKIP_REASONS)[number]

export const VOICE_QUEUE_TERMINAL_ITEM_STATUSES = [
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
] as const

export type VoiceQueueTerminalItemStatus = (typeof VOICE_QUEUE_TERMINAL_ITEM_STATUSES)[number]
export type VoiceQueueStatus =
  | "prepared"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "attention_required"

export type VoiceQueueItemStatus =
  | "pending"
  | "claimed"
  | "dispatching"
  | "waiting_terminal"
  | "dispatch_uncertain"
  | VoiceQueueTerminalItemStatus

export type VoiceQueueBlocker =
  | "voice_queue_disabled"
  | "no_phone"
  | "lead_inactive"
  | "voice_opt_out"
  | "connected_before"
  | "already_queued"
  | "duplicate_phone"
  | "user_limit_reached"
  | "organization_limit_reached"

export type VoiceQueueErrorCode =
  | "voice_queue_disabled"
  | "invalid_selection"
  | "consent_required"
  | "consent_audit_invalid"
  | "owner_scope_required"
  | "queue_not_found"
  | "idempotency_conflict"
  | "already_queued"
  | "active_queue_exists"
  | "queue_not_mutable"
  | "item_not_skippable"
  | "uncertain_resolution_too_early"
  | "uncertain_call_still_active"
  | "uncertain_status_unavailable"
  | "uncertain_item_stale"

export class VoiceQueueError extends Error {
  constructor(readonly code: VoiceQueueErrorCode) {
    super(code)
    this.name = "VoiceQueueError"
  }
}

export function voiceQueueErrorStatus(code: VoiceQueueErrorCode): 400 | 404 | 409 {
  switch (code) {
    case "invalid_selection":
    case "consent_required":
    case "consent_audit_invalid":
    case "owner_scope_required":
      return 400
    case "queue_not_found":
      return 404
    default:
      return 409
  }
}

type QueueAuth = Pick<AuthResult, "orgId" | "userId" | "role">

type QueueDb = Pick<
  Prisma.TransactionClient,
  | "channelConfig"
  | "user"
  | "lead"
  | "callLog"
  | "voiceCallSession"
  | "voiceConsent"
  | "voiceSuppression"
  | "voiceCallQueue"
  | "voiceCallQueueItem"
  | "callEvent"
>

export type VoiceQueueDb = QueueDb
export type VoiceQueueRootDb = Pick<
  PrismaClient,
  | "channelConfig"
  | "user"
  | "lead"
  | "callLog"
  | "voiceCallSession"
  | "voiceConsent"
  | "voiceSuppression"
  | "voiceCallQueue"
  | "voiceCallQueueItem"
  | "callEvent"
  | "$transaction"
>

export type VoiceQueueFeatureEvaluation = {
  enabled: boolean
  blocker: "voice_queue_disabled" | null
}

export type VoiceQueueFeatureOptions = {
  executionEnabled?: boolean
  pilotOrganizationId?: string | null
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Queue automation has an independent two-sided gate. A tenant setting alone
 * cannot activate production dispatch, and a server flag alone cannot opt a
 * tenant in. The response deliberately does not reveal which side is absent.
 */
export async function evaluateVoiceQueueFeature(params: {
  db: Pick<QueueDb, "channelConfig">
  organizationId: string
  options?: VoiceQueueFeatureOptions
}): Promise<VoiceQueueFeatureEvaluation> {
  const executionEnabled = params.options?.executionEnabled
    ?? process.env.VOICE_CALL_QUEUE_EXECUTION_ENABLED === "true"
  const pilotOrganizationId = params.options?.pilotOrganizationId
    ?? process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()

  if (!executionEnabled || !pilotOrganizationId || pilotOrganizationId !== params.organizationId) {
    return { enabled: false, blocker: "voice_queue_disabled" }
  }

  const rows = await params.db.channelConfig.findMany({
    where: {
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
  const enabled = rows.some((row) => {
    const raw = jsonRecord(row.settings)
    const mode = raw.voiceAgentMode
    const normalized = normalizeVoipSettings(row, params.organizationId)
    return raw.voiceQueueEnabled === true
      && raw.manualLeadAiCallsEnabled === true
      && raw.voiceAgentEnabled === true
      && (mode === "outbound" || mode === "both")
      && normalized?.provider === "asterisk"
      && missingVoipFields(normalized).length === 0
  })
  return enabled
    ? { enabled: true, blocker: null }
    : { enabled: false, blocker: "voice_queue_disabled" }
}

export function resolveVoiceQueueOwner(params: {
  auth: QueueAuth
  ownerUserId?: string | null
}): string {
  const requested = params.ownerUserId?.trim()
  if (isManagerOrAbove(params.auth.role)) {
    if (!requested) throw new VoiceQueueError("owner_scope_required")
    return requested
  }
  if (requested && requested !== params.auth.userId) {
    // Deliberately hide whether the requested user exists in this tenant.
    throw new VoiceQueueError("queue_not_found")
  }
  return params.auth.userId
}

function normalizeSelection(leadIds: readonly string[]): string[] {
  if (
    leadIds.length === 0
    || leadIds.length > VOICE_QUEUE_MAX_SELECTED_LEADS
    || leadIds.some((leadId) => typeof leadId !== "string" || !leadId.trim() || leadId.length > 160)
  ) {
    throw new VoiceQueueError("invalid_selection")
  }
  const normalized = leadIds.map((leadId) => leadId.trim())
  if (new Set(normalized).size !== normalized.length) {
    throw new VoiceQueueError("invalid_selection")
  }
  return normalized
}

function selectionHash(ownerUserId: string, leadIds: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ ownerUserId, leadIds }))
    .digest("hex")
}

async function assertActiveOwner(db: Pick<QueueDb, "user">, auth: QueueAuth, ownerUserId: string) {
  const owner = await db.user.findFirst({
    where: {
      id: ownerUserId,
      organizationId: auth.orgId,
      isActive: true,
      role: "sales",
    },
    select: { id: true },
  })
  if (!owner) throw new VoiceQueueError("queue_not_found")
}

type SelectedLead = {
  id: string
  assignedTo: string | null
  status: string
  phone: string | null
}

async function loadSelectedLeads(params: {
  db: Pick<QueueDb, "lead">
  auth: QueueAuth
  ownerUserId: string
  leadIds: readonly string[]
}): Promise<SelectedLead[]> {
  const rows = await params.db.lead.findMany({
    where: {
      organizationId: params.auth.orgId,
      id: { in: [...params.leadIds] },
      assignedTo: params.ownerUserId,
    },
    select: { id: true, assignedTo: true, status: true, phone: true },
  })
  if (rows.length !== params.leadIds.length) throw new VoiceQueueError("queue_not_found")
  const byId = new Map(rows.map((row) => [row.id, row]))
  return params.leadIds.map((leadId) => {
    const lead = byId.get(leadId)
    if (!lead) throw new VoiceQueueError("queue_not_found")
    return lead
  })
}

export type VoiceQueuePreviewItem = {
  leadId: string
  position: number
  eligible: boolean
  blockers: VoiceQueueBlocker[]
}

export type VoiceQueuePreview = {
  enabled: boolean
  blocker: "voice_queue_disabled" | null
  blockers: Array<"voice_queue_disabled">
  ownerUserId: string
  total: number
  eligible: number
  items: VoiceQueuePreviewItem[]
  limits: { userRemaining: number; organizationRemaining: number }
}

export async function previewSelectedVoiceQueue(params: {
  db: QueueDb
  auth: QueueAuth
  ownerUserId?: string | null
  leadIds: readonly string[]
  now?: Date
  featureOptions?: VoiceQueueFeatureOptions
}): Promise<VoiceQueuePreview> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  const leadIds = normalizeSelection(params.leadIds)
  const now = params.now ?? new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000)

  const [feature, leads] = await Promise.all([
    evaluateVoiceQueueFeature({
      db: params.db,
      organizationId: params.auth.orgId,
      options: params.featureOptions,
    }),
    (async () => {
      await assertActiveOwner(params.db, params.auth, ownerUserId)
      return loadSelectedLeads({ db: params.db, auth: params.auth, ownerUserId, leadIds })
    })(),
  ])

  const normalizedPhones = leads.flatMap((lead) => {
    const phone = normalizeManualLeadPhone(lead.phone)?.e164
    return phone ? [phone] : []
  })
  const callHistoryTargets = leads.flatMap((lead) => {
    const targetPhoneE164 = normalizeManualLeadPhone(lead.phone)?.e164
    return targetPhoneE164 ? [{ leadId: lead.id, targetPhoneE164 }] : []
  })
  const [
    suppressions,
    consents,
    priorCallHistory,
    alreadyQueued,
    userAttemptCount,
    organizationAttemptCount,
  ] = await Promise.all([
    normalizedPhones.length > 0
      ? params.db.voiceSuppression.findMany({
          where: {
            organizationId: params.auth.orgId,
            phoneE164: { in: normalizedPhones },
            scope: { in: ["sales", "all"] },
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { phoneE164: true },
        })
      : Promise.resolve([]),
    normalizedPhones.length > 0
      ? params.db.voiceConsent.findMany({
          where: {
            organizationId: params.auth.orgId,
            phoneE164: { in: normalizedPhones },
            scope: { in: ["sales", "all"] },
            status: "blocked",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { phoneE164: true },
        })
      : Promise.resolve([]),
    loadPriorConnectedCallHistory({
      db: params.db,
      organizationId: params.auth.orgId,
      targets: callHistoryTargets,
    }),
    params.db.voiceCallQueueItem.findMany({
      where: {
        organizationId: params.auth.orgId,
        OR: [
          { queuedLeadKey: { in: leadIds } },
          ...(normalizedPhones.length > 0
            ? [{ queuedPhoneKey: { in: normalizedPhones } }]
            : []),
        ],
      },
      select: { leadId: true, queuedPhoneKey: true },
    }),
    params.db.voiceCallSession.count({
      where: {
        organizationId: params.auth.orgId,
        requestedByUserId: ownerUserId,
        createdAt: { gte: since },
      },
    }),
    params.db.voiceCallSession.count({
      where: { organizationId: params.auth.orgId, createdAt: { gte: since } },
    }),
  ])

  const suppressedPhones = new Set(suppressions.map((row) => row.phoneE164))
  const blockedConsentPhones = new Set(consents.map((row) => row.phoneE164))
  const previouslyCalledLeadIds = priorCallHistory.connectedLeadIds
  const previouslyCalledPhones = priorCallHistory.connectedPhoneE164s
  const alreadyQueuedLeadIds = new Set(alreadyQueued.map((row) => row.leadId))
  const alreadyQueuedPhones = new Set(alreadyQueued.flatMap((row) => (
    row.queuedPhoneKey ? [row.queuedPhoneKey] : []
  )))
  const userRemaining = Math.max(0, MANUAL_LEAD_AI_USER_LIMIT_24H - userAttemptCount)
  const organizationRemaining = Math.max(
    0,
    MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H - organizationAttemptCount,
  )
  let capacityPosition = 0
  const selectedPhones = new Set<string>()

  const items = leads.map((lead, position): VoiceQueuePreviewItem => {
    const blockers: VoiceQueueBlocker[] = []
    const phone = normalizeManualLeadPhone(lead.phone)?.e164 ?? null
    if (!phone) blockers.push("no_phone")
    if (["converted", "lost"].includes(lead.status.toLowerCase())) blockers.push("lead_inactive")
    if (phone && (suppressedPhones.has(phone) || blockedConsentPhones.has(phone))) {
      blockers.push("voice_opt_out")
    }
    if (
      previouslyCalledLeadIds.has(lead.id)
      || (phone !== null && previouslyCalledPhones.has(phone))
    ) blockers.push("connected_before")
    if (
      alreadyQueuedLeadIds.has(lead.id)
      || (phone !== null && alreadyQueuedPhones.has(phone))
    ) blockers.push("already_queued")

    // An invalid/suppressed/history-blocked row must not reserve the number and
    // exclude a later safe duplicate. Reserve immediately before quota so only
    // the first otherwise-eligible candidate can enter this immutable batch.
    if (blockers.length === 0 && phone) {
      if (selectedPhones.has(phone)) blockers.push("duplicate_phone")
      else selectedPhones.add(phone)
    }

    const safeBeforeQuota = blockers.length === 0
    if (safeBeforeQuota) {
      if (capacityPosition >= userRemaining) blockers.push("user_limit_reached")
      if (capacityPosition >= organizationRemaining) blockers.push("organization_limit_reached")
      capacityPosition += 1
    }
    return { leadId: lead.id, position, eligible: blockers.length === 0, blockers }
  })

  return {
    enabled: feature.enabled,
    blocker: feature.blocker,
    blockers: feature.blocker ? [feature.blocker] : [],
    ownerUserId,
    total: items.length,
    eligible: items.filter((item) => item.eligible).length,
    items,
    limits: { userRemaining, organizationRemaining },
  }
}

export type VoiceQueueSafeItem = {
  id: string
  leadId: string
  position: number
  status: VoiceQueueItemStatus
  outcome: string | null
  blockReason: string | null
  voiceCallSessionId: string | null
  claimedAt: Date | null
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
}

export type VoiceQueueSafeView = {
  id: string
  ownerUserId: string
  createdByUserId: string
  name: string | null
  source: string
  status: VoiceQueueStatus
  totalItems: number
  counts: Record<VoiceQueueItemStatus, number>
  startedAt: Date | null
  pausedAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  items?: VoiceQueueSafeItem[]
}

const ITEM_STATUS_KEYS: VoiceQueueItemStatus[] = [
  "pending",
  "claimed",
  "dispatching",
  "waiting_terminal",
  "dispatch_uncertain",
  ...VOICE_QUEUE_TERMINAL_ITEM_STATUSES,
]

function safeQueueView(row: {
  id: string
  ownerUserId: string
  createdByUserId: string
  name: string | null
  source: string
  status: string
  totalItems: number
  startedAt: Date | null
  pausedAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  items: Array<{
    id: string
    leadId: string
    position: number
    status: string
    outcome: string | null
    blockReason: string | null
    voiceCallSessionId: string | null
    claimedAt: Date | null
    startedAt: Date | null
    endedAt: Date | null
    createdAt: Date
  }>
}, includeItems: boolean): VoiceQueueSafeView {
  const counts = Object.fromEntries(ITEM_STATUS_KEYS.map((status) => [status, 0])) as Record<VoiceQueueItemStatus, number>
  for (const item of row.items) {
    if (item.status in counts) counts[item.status as VoiceQueueItemStatus] += 1
  }
  const items = row.items.map((item) => ({
    ...item,
    status: item.status as VoiceQueueItemStatus,
  }))
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    createdByUserId: row.createdByUserId,
    name: row.name,
    source: row.source,
    status: row.status as VoiceQueueStatus,
    totalItems: row.totalItems,
    counts,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(includeItems ? { items } : {}),
  }
}

const SAFE_QUEUE_INCLUDE = {
  items: {
    orderBy: { position: "asc" as const },
    select: {
      id: true,
      leadId: true,
      position: true,
      status: true,
      outcome: true,
      blockReason: true,
      voiceCallSessionId: true,
      claimedAt: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
    },
  },
}

async function getScopedQueueRow(params: {
  db: Pick<QueueDb, "voiceCallQueue">
  auth: QueueAuth
  ownerUserId: string
  queueId: string
}) {
  const row = await params.db.voiceCallQueue.findFirst({
    where: {
      id: params.queueId,
      organizationId: params.auth.orgId,
      ownerUserId: params.ownerUserId,
    },
    include: SAFE_QUEUE_INCLUDE,
  })
  if (!row) throw new VoiceQueueError("queue_not_found")
  return row
}

export function isValidVoiceQueueConsentAudit(value: Prisma.JsonValue): boolean {
  const audit = jsonRecord(value)
  return audit.scope === "sales"
    && audit.consentConfirmed === true
    && audit.basis === "bulk_per_call_attestation"
    && typeof audit.attestedByUserId === "string"
    && audit.attestedByUserId.length > 0
    && typeof audit.attestedAt === "string"
    && Number.isFinite(Date.parse(audit.attestedAt))
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

export async function createSelectedVoiceQueue(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  leadIds: readonly string[]
  idempotencyKey: string
  consentConfirmed: true
  name?: string | null
  now?: Date
  featureOptions?: VoiceQueueFeatureOptions
}): Promise<{ queue: VoiceQueueSafeView; replayed: boolean }> {
  if (params.consentConfirmed !== true) throw new VoiceQueueError("consent_required")
  const ownerUserId = resolveVoiceQueueOwner(params)
  const leadIds = normalizeSelection(params.leadIds)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.idempotencyKey)) {
    throw new VoiceQueueError("invalid_selection")
  }
  const name = params.name?.trim() || null
  if (name && name.length > 120) throw new VoiceQueueError("invalid_selection")
  const hash = selectionHash(ownerUserId, leadIds)
  const now = params.now ?? new Date()

  const feature = await evaluateVoiceQueueFeature({
    db: params.db,
    organizationId: params.auth.orgId,
    options: params.featureOptions,
  })
  if (!feature.enabled) throw new VoiceQueueError("voice_queue_disabled")

  const existing = await params.db.voiceCallQueue.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: params.auth.orgId,
        idempotencyKey: params.idempotencyKey,
      },
    },
    include: SAFE_QUEUE_INCLUDE,
  })
  if (existing) {
    if (existing.ownerUserId !== ownerUserId || existing.selectionHash !== hash) {
      throw new VoiceQueueError("idempotency_conflict")
    }
    return { queue: safeQueueView(existing, true), replayed: true }
  }

  try {
    const created = await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      await assertActiveOwner(tx, params.auth, ownerUserId)
      const refreshed = await previewSelectedVoiceQueue({
        db: tx,
        auth: params.auth,
        ownerUserId,
        leadIds,
        now,
        featureOptions: params.featureOptions,
      })
      const eligibleLeadIds = refreshed.items
        .filter((item) => item.eligible)
        .map((item) => item.leadId)
      if (eligibleLeadIds.length === 0) throw new VoiceQueueError("invalid_selection")
      const leads = await loadSelectedLeads({
        db: tx,
        auth: params.auth,
        ownerUserId,
        leadIds: eligibleLeadIds,
      })
      return tx.voiceCallQueue.create({
        data: {
          organizationId: params.auth.orgId,
          ownerUserId,
          createdByUserId: params.auth.userId,
          idempotencyKey: params.idempotencyKey,
          selectionHash: hash,
          source: "selected",
          name,
          status: "prepared",
          totalItems: eligibleLeadIds.length,
          consentAudit: {
            scope: "sales",
            consentConfirmed: true,
            basis: "bulk_per_call_attestation",
            attestedByUserId: params.auth.userId,
            attestedAt: now.toISOString(),
          },
          items: {
            create: leads.map((lead, position) => {
              const queuedPhone = normalizeManualLeadPhone(lead.phone)?.e164
              if (!queuedPhone) throw new VoiceQueueError("invalid_selection")
              return {
                organizationId: params.auth.orgId,
                ownerUserId,
                leadId: lead.id,
                assignedToSnapshot: ownerUserId,
                position,
                idempotencyKey: randomUUID(),
                status: "pending",
                queuedLeadKey: lead.id,
                queuedPhoneKey: queuedPhone,
              }
            }),
          },
        },
        include: SAFE_QUEUE_INCLUDE,
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { queue: safeQueueView(created, true), replayed: false }
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const raced = await params.db.voiceCallQueue.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: params.auth.orgId,
          idempotencyKey: params.idempotencyKey,
        },
      },
      include: SAFE_QUEUE_INCLUDE,
    })
    if (raced) {
      if (raced.ownerUserId !== ownerUserId || raced.selectionHash !== hash) {
        throw new VoiceQueueError("idempotency_conflict")
      }
      return { queue: safeQueueView(raced, true), replayed: true }
    }
    const refreshed = await previewSelectedVoiceQueue({
      db: params.db,
      auth: params.auth,
      ownerUserId,
      leadIds,
      now,
      featureOptions: params.featureOptions,
    })
    if (refreshed.items.some((item) => item.blockers.includes("already_queued"))) {
      throw new VoiceQueueError("already_queued")
    }
    throw new VoiceQueueError("idempotency_conflict")
  }
}

export async function listVoiceQueues(params: {
  db: Pick<QueueDb, "voiceCallQueue">
  auth: QueueAuth
  ownerUserId?: string | null
  cursor?: string | null
  limit?: number
}): Promise<{ queues: VoiceQueueSafeView[]; nextCursor: string | null }> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  const limit = Math.max(1, Math.min(VOICE_QUEUE_LIST_LIMIT, params.limit ?? 20))
  const rows = await params.db.voiceCallQueue.findMany({
    where: { organizationId: params.auth.orgId, ownerUserId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    include: SAFE_QUEUE_INCLUDE,
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    queues: page.map((row) => safeQueueView(row, false)),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  }
}

export async function getVoiceQueue(params: {
  db: Pick<QueueDb, "voiceCallQueue">
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
}): Promise<VoiceQueueSafeView> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  return safeQueueView(await getScopedQueueRow({ ...params, ownerUserId }), true)
}

async function assertQueueFeatureAndConsent(params: {
  db: Pick<QueueDb, "channelConfig" | "voiceCallQueue">
  auth: QueueAuth
  ownerUserId: string
  queueId: string
  featureOptions?: VoiceQueueFeatureOptions
}) {
  const [feature, queue] = await Promise.all([
    evaluateVoiceQueueFeature({
      db: params.db,
      organizationId: params.auth.orgId,
      options: params.featureOptions,
    }),
    params.db.voiceCallQueue.findFirst({
      where: {
        id: params.queueId,
        organizationId: params.auth.orgId,
        ownerUserId: params.ownerUserId,
      },
      select: { id: true, consentAudit: true },
    }),
  ])
  if (!queue) throw new VoiceQueueError("queue_not_found")
  if (!feature.enabled) throw new VoiceQueueError("voice_queue_disabled")
  if (!isValidVoiceQueueConsentAudit(queue.consentAudit)) {
    throw new VoiceQueueError("consent_audit_invalid")
  }
}

export async function startVoiceQueue(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
  now?: Date
  featureOptions?: VoiceQueueFeatureOptions
}): Promise<VoiceQueueSafeView> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  await assertQueueFeatureAndConsent({ ...params, ownerUserId })
  const now = params.now ?? new Date()
  try {
    const changed = await params.db.voiceCallQueue.updateMany({
      where: {
        id: params.queueId,
        organizationId: params.auth.orgId,
        ownerUserId,
        status: "prepared",
      },
      data: {
        status: "running",
        activeOrganizationKey: params.auth.orgId,
        activeOwnerKey: `${params.auth.orgId}:${ownerUserId}`,
        startedAt: now,
        pausedAt: null,
      },
    })
    if (changed.count !== 1) throw new VoiceQueueError("queue_not_mutable")
  } catch (error) {
    if (isUniqueConflict(error)) throw new VoiceQueueError("active_queue_exists")
    throw error
  }
  return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
}

export async function pauseVoiceQueue(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
  now?: Date
}): Promise<VoiceQueueSafeView> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  const changed = await params.db.voiceCallQueue.updateMany({
    where: {
      id: params.queueId,
      organizationId: params.auth.orgId,
      ownerUserId,
      status: "running",
    },
    data: { status: "paused", pausedAt: params.now ?? new Date() },
  })
  if (changed.count !== 1) throw new VoiceQueueError("queue_not_mutable")
  return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
}

export async function resumeVoiceQueue(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
  featureOptions?: VoiceQueueFeatureOptions
}): Promise<VoiceQueueSafeView> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  await assertQueueFeatureAndConsent({ ...params, ownerUserId })
  const changed = await params.db.voiceCallQueue.updateMany({
    where: {
      id: params.queueId,
      organizationId: params.auth.orgId,
      ownerUserId,
      status: "paused",
      activeOrganizationKey: params.auth.orgId,
      activeOwnerKey: `${params.auth.orgId}:${ownerUserId}`,
    },
    data: { status: "running", pausedAt: null },
  })
  if (changed.count !== 1) throw new VoiceQueueError("queue_not_mutable")
  return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
}

export async function cancelVoiceQueue(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
  now?: Date
}): Promise<VoiceQueueSafeView> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  const now = params.now ?? new Date()
  const changed = await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
    const queue = await tx.voiceCallQueue.updateMany({
      where: {
        id: params.queueId,
        organizationId: params.auth.orgId,
        ownerUserId,
        status: { in: ["prepared", "running", "paused", "attention_required"] },
      },
      data: {
        status: "cancelled",
        activeOrganizationKey: null,
        activeOwnerKey: null,
        cancelledAt: now,
      },
    })
    if (queue.count !== 1) return false
    await tx.voiceCallQueueItem.updateMany({
      where: {
        organizationId: params.auth.orgId,
        queueId: params.queueId,
        ownerUserId,
        status: "pending",
      },
      data: {
        status: "cancelled",
        outcome: "cancelled",
        queuedLeadKey: null,
        queuedPhoneKey: null,
        endedAt: now,
      },
    })
    return true
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  if (!changed) throw new VoiceQueueError("queue_not_mutable")
  return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
}

export async function skipVoiceQueueItem(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
  itemId: string
  reason: VoiceQueueSkipReason
  now?: Date
}): Promise<VoiceQueueSafeView> {
  const ownerUserId = resolveVoiceQueueOwner(params)
  const now = params.now ?? new Date()
  const changed = await params.db.voiceCallQueueItem.updateMany({
    where: {
      id: params.itemId,
      organizationId: params.auth.orgId,
      queueId: params.queueId,
      ownerUserId,
      status: "pending",
      queue: { status: { in: ["prepared", "running", "paused"] } },
    },
    data: {
      status: "skipped",
      outcome: "skipped",
      blockReason: params.reason,
      queuedLeadKey: null,
      queuedPhoneKey: null,
      endedAt: now,
    },
  })
  if (changed.count !== 1) throw new VoiceQueueError("item_not_skippable")
  await completeVoiceQueueIfDrained({
    db: params.db,
    organizationId: params.auth.orgId,
    queueId: params.queueId,
    now,
  })
  return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
}

type UncertainCallFinalizer = (params: {
  settings: AsteriskSettings
  providerCallId: string
}) => Promise<CallFinalityResult>

async function cancelAndInspectAsteriskAttempt(params: {
  settings: AsteriskSettings
  providerCallId: string
}): Promise<CallFinalityResult> {
  const provider = getVoipProvider(params.settings)
  if (!provider.cancelAndInspectCallFinality) return { state: "unknown" }
  return provider.cancelAndInspectCallFinality(params.providerCallId)
}

/**
 * Transactional half of a future dispatch-uncertain resolution flow.
 *
 * Production callers deliberately cannot fall back to an ARI channel-absence
 * probe: a timed-out originate may create its channel after the probe and make
 * releasing the global/phone fences unsafe. Only the PBX attempt registry's
 * durable cancellation tombstone or immutable terminal record may settle it.
 */
export async function resolveUncertainVoiceQueueItem(params: {
  db: VoiceQueueRootDb
  auth: QueueAuth
  ownerUserId?: string | null
  queueId: string
  itemId: string
  acknowledgeNoRedial: boolean
  now?: Date
  minimumAgeMs?: number
  finalizeCallAttempt?: UncertainCallFinalizer
}): Promise<VoiceQueueSafeView> {
  if (!isManagerOrAbove(params.auth.role)) throw new VoiceQueueError("queue_not_found")
  if (!params.acknowledgeNoRedial) throw new VoiceQueueError("consent_required")

  const ownerUserId = resolveVoiceQueueOwner(params)
  const now = params.now ?? new Date()
  const candidate = await params.db.voiceCallQueueItem.findFirst({
    where: {
      id: params.itemId,
      organizationId: params.auth.orgId,
      queueId: params.queueId,
      ownerUserId,
      status: "dispatch_uncertain",
      queue: { status: "attention_required" },
      voiceCallSession: {
        is: {
          organizationId: params.auth.orgId,
          status: "dispatch_uncertain",
          OR: [
            {
              endedAt: null,
              activeOrganizationKey: params.auth.orgId,
            },
            {
              blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
              endedAt: { not: null },
              activeOrganizationKey: null,
            },
          ],
        },
      },
    },
    select: {
      id: true,
      queueId: true,
      updatedAt: true,
      voiceCallSession: {
        select: {
          id: true,
          providerCallId: true,
          channelConfigId: true,
          callLogId: true,
          blockReason: true,
        },
      },
    },
  })
  if (!candidate?.voiceCallSession) throw new VoiceQueueError("uncertain_item_stale")
  const callLogId = candidate.voiceCallSession.callLogId
  if (!callLogId) throw new VoiceQueueError("uncertain_item_stale")

  const minimumAgeMs = params.minimumAgeMs ?? VOICE_QUEUE_UNCERTAIN_RESOLUTION_MIN_AGE_MS
  if (now.getTime() - candidate.updatedAt.getTime() < minimumAgeMs) {
    throw new VoiceQueueError("uncertain_resolution_too_early")
  }

  if (candidate.voiceCallSession.blockReason === PROVIDER_UNKNOWN_NO_REDIAL) {
    const acknowledged = await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const sessionChanged = await tx.voiceCallSession.updateMany({
        where: {
          id: candidate.voiceCallSession!.id,
          organizationId: params.auth.orgId,
          status: "dispatch_uncertain",
          outcome: null,
          blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
          activeOrganizationKey: null,
          endedAt: { not: null },
        },
        data: {
          status: "cancelled",
          outcome: "operator_closed_unknown_no_redial",
          blockReason: "operator_closed_unknown_no_redial",
          leaseUntil: null,
          activeOrganizationKey: null,
          activeLeadKey: null,
          activePhoneKey: null,
        },
      })
      if (sessionChanged.count !== 1) return false

      const itemChanged = await tx.voiceCallQueueItem.updateMany({
        where: {
          id: candidate.id,
          organizationId: params.auth.orgId,
          queueId: params.queueId,
          ownerUserId,
          status: "dispatch_uncertain",
          blockReason: PROVIDER_UNKNOWN_NO_REDIAL,
          voiceCallSessionId: candidate.voiceCallSession!.id,
        },
        data: {
          status: "skipped",
          outcome: "skipped",
          blockReason: "operator_closed_unknown_no_redial",
          queuedLeadKey: null,
          queuedPhoneKey: null,
          activeOrganizationKey: null,
          activeOwnerKey: null,
          leaseToken: null,
          leaseUntil: null,
          endedAt: now,
        },
      })
      if (itemChanged.count !== 1) throw new VoiceQueueError("uncertain_item_stale")

      const callChanged = await tx.callLog.updateMany({
        where: {
          id: callLogId,
          organizationId: params.auth.orgId,
          provider: "asterisk",
          providerCallId: candidate.voiceCallSession!.providerCallId,
          providerOutcome: null,
          conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL,
        },
        data: { conversationOutcome: "operator_closed_unknown_no_redial" },
      })
      if (callChanged.count !== 1) throw new VoiceQueueError("uncertain_item_stale")

      await tx.callEvent.create({
        data: {
          organizationId: params.auth.orgId,
          callLogId,
          provider: "asterisk",
          providerCallId: candidate.voiceCallSession!.providerCallId,
          eventType: "voice_provider_unknown_acknowledged",
          eventHash: "voice-provider-unknown-acknowledged-v1",
          payload: {
            resolution: "operator_closed_unknown_no_redial",
            resolvedByUserId: params.auth.userId,
            resolvedAt: now.toISOString(),
          },
        },
      })

      const completed = await completeVoiceQueueIfDrained({
        db: tx,
        organizationId: params.auth.orgId,
        queueId: params.queueId,
        now,
      })
      if (!completed) {
        const paused = await tx.voiceCallQueue.updateMany({
          where: {
            id: params.queueId,
            organizationId: params.auth.orgId,
            ownerUserId,
            status: "attention_required",
          },
          data: { status: "paused", pausedAt: now },
        })
        if (paused.count !== 1) throw new VoiceQueueError("uncertain_item_stale")
      }
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!acknowledged) throw new VoiceQueueError("uncertain_item_stale")
    return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
  }

  const config = await params.db.channelConfig.findFirst({
    where: {
      id: candidate.voiceCallSession.channelConfigId,
      organizationId: params.auth.orgId,
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
  const settings = config ? normalizeVoipSettings(config, params.auth.orgId) : null
  if (!settings || settings.provider !== "asterisk" || missingVoipFields(settings).length > 0) {
    throw new VoiceQueueError("uncertain_status_unavailable")
  }

  let finality: CallFinalityResult
  try {
    finality = await (params.finalizeCallAttempt ?? cancelAndInspectAsteriskAttempt)({
      settings,
      providerCallId: candidate.voiceCallSession.providerCallId,
    })
  } catch {
    throw new VoiceQueueError("uncertain_status_unavailable")
  }
  if (finality.state === "accepted" || finality.state === "active") {
    throw new VoiceQueueError("uncertain_call_still_active")
  }
  if (finality.state === "unknown") throw new VoiceQueueError("uncertain_status_unavailable")

  const terminalOutcome = finality.state === "terminal" ? finality.outcome : "failed"
  const sessionStatusByOutcome = {
    connected: "completed",
    no_answer: "no_answer",
    busy: "busy",
    failed: "failed",
    cancelled: "cancelled",
  } as const
  const itemStatusByOutcome = {
    connected: "completed",
    no_answer: "no_answer",
    busy: "busy",
    failed: "failed",
    cancelled: "cancelled",
  } as const
  const callStatusByOutcome = {
    connected: "completed",
    no_answer: "no-answer",
    busy: "busy",
    failed: "failed",
    cancelled: "canceled",
  } as const
  const resolution = finality.state === "not_accepted"
    ? "provider_not_accepted"
    : `provider_terminal_${terminalOutcome}`

  try {
    const resolved = await params.db.$transaction(async (tx: Prisma.TransactionClient) => {
      const sessionChanged = await tx.voiceCallSession.updateMany({
        where: {
          id: candidate.voiceCallSession!.id,
          organizationId: params.auth.orgId,
          status: "dispatch_uncertain",
          endedAt: null,
          activeOrganizationKey: params.auth.orgId,
        },
        data: {
          status: sessionStatusByOutcome[terminalOutcome],
          outcome: finality.state === "not_accepted" ? "failed" : terminalOutcome,
          blockReason: finality.state === "not_accepted" ? resolution : null,
          leaseUntil: null,
          activeOrganizationKey: null,
          activeLeadKey: null,
          activePhoneKey: null,
          endedAt: now,
        },
      })
      if (sessionChanged.count !== 1) return false

      const itemChanged = await tx.voiceCallQueueItem.updateMany({
        where: {
          id: candidate.id,
          organizationId: params.auth.orgId,
          queueId: params.queueId,
          ownerUserId,
          status: "dispatch_uncertain",
          voiceCallSessionId: candidate.voiceCallSession!.id,
        },
        data: {
          status: itemStatusByOutcome[terminalOutcome],
          outcome: finality.state === "not_accepted" ? "failed" : terminalOutcome,
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
      if (itemChanged.count !== 1) throw new VoiceQueueError("uncertain_item_stale")

      await tx.callLog.updateMany({
        where: {
          id: callLogId,
          organizationId: params.auth.orgId,
          provider: "asterisk",
          providerCallId: candidate.voiceCallSession!.providerCallId,
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
          : terminalOutcome === "connected"
            ? {
                status: "completed",
                wasAnswered: true,
                conversationOutcome: AI_CONNECTED_PENDING_RESULT,
                endedAt: now,
              }
            : {
                status: callStatusByOutcome[terminalOutcome],
                providerOutcome: terminalOutcome,
                conversationOutcome: terminalOutcome,
                wasAnswered: false,
                endedAt: now,
              },
      })

      await tx.callEvent.create({
        data: {
          organizationId: params.auth.orgId,
          callLogId,
          provider: "asterisk",
          providerCallId: candidate.voiceCallSession!.providerCallId,
          eventType: "voice_provider_finality_resolved",
          eventHash: "voice-provider-finality-resolution-v1",
          payload: {
            resolution,
            resolvedByUserId: params.auth.userId,
            resolvedAt: now.toISOString(),
            providerState: finality.state,
            providerOutcome: finality.state === "terminal" ? finality.outcome : null,
            providerRevision: finality.revision,
            providerUpdatedAt: finality.updatedAt,
          },
        },
      })

      const completed = await completeVoiceQueueIfDrained({
        db: tx,
        organizationId: params.auth.orgId,
        queueId: params.queueId,
        now,
      })
      if (!completed) {
        const paused = await tx.voiceCallQueue.updateMany({
          where: {
            id: params.queueId,
            organizationId: params.auth.orgId,
            ownerUserId,
            status: "attention_required",
          },
          data: { status: "paused", pausedAt: now },
        })
        if (paused.count !== 1) throw new VoiceQueueError("uncertain_item_stale")
      }
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!resolved) throw new VoiceQueueError("uncertain_item_stale")
  } catch (error) {
    if (error instanceof VoiceQueueError) throw error
    if (isUniqueConflict(error)) throw new VoiceQueueError("uncertain_item_stale")
    throw error
  }

  return getVoiceQueue({ db: params.db, auth: params.auth, ownerUserId, queueId: params.queueId })
}

export async function completeVoiceQueueIfDrained(params: {
  db: Pick<QueueDb, "voiceCallQueue" | "voiceCallQueueItem">
  organizationId: string
  queueId: string
  now?: Date
}): Promise<boolean> {
  const remaining = await params.db.voiceCallQueueItem.count({
    where: {
      organizationId: params.organizationId,
      queueId: params.queueId,
      status: { notIn: [...VOICE_QUEUE_TERMINAL_ITEM_STATUSES] },
    },
  })
  if (remaining > 0) return false
  const changed = await params.db.voiceCallQueue.updateMany({
    where: {
      id: params.queueId,
      organizationId: params.organizationId,
      status: { in: ["prepared", "running", "paused", "attention_required"] },
    },
    data: {
      status: "completed",
      activeOrganizationKey: null,
      activeOwnerKey: null,
      completedAt: params.now ?? new Date(),
    },
  })
  return changed.count === 1
}
