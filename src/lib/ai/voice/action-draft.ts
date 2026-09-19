import { createHash, randomBytes } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { AuthResult } from "@/lib/api-auth"
import { getOrgModuleContext } from "@/lib/api-auth"
import { prisma, logAudit } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { checkPermission } from "@/lib/permissions"
import { hasModule } from "@/lib/modules"
import { azerbaijaniLocalPart } from "@/lib/inbox/customer-phone"
import {
  aiActionIntentExpiresAt,
  canonicalizeAiActionIntentJson,
  hashAiActionIntentPayload,
} from "./action-intent"
import {
  getAiVoiceActionDefinition,
  isAiVoiceActionType,
  parseAiVoiceActionPayload,
  type AiVoiceActionPreviewContext,
  type AiVoiceActionType,
} from "./action-registry"

type JsonObject = Record<string, unknown>

const ACTIVE_DRAFT_STATES = ["collecting", "awaiting_confirmation"] as const

export class AiVoiceActionDraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = "AiVoiceActionDraftError"
  }
}

export type CreateAiVoiceActionDraftInput = Readonly<{
  voiceSessionId: string
  actionType: AiVoiceActionType
  payload: JsonObject
  idempotencyKey: string
  providerToolCallId?: string
  targetEntityId?: string
}>

type StoredIntent = Readonly<{
  id: string
  organizationId: string
  userId: string
  voiceSessionId: string
  actionType: string
  rawPayload: unknown
  normalizedPayload: unknown
  state: string
  revision: number
  payloadHash: string
  preview: unknown
  warnings: unknown
  targetEntityType: string | null
  targetEntityId: string | null
  expectedUpdatedAt: Date | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}>

export type UpdateAiVoiceActionDraftInput = Readonly<{
  intentId: string
  expectedRevision: number
  payload: JsonObject
}>

export type CancelAiVoiceActionDraftInput = Readonly<{
  intentId: string
  expectedRevision: number
}>

export type IssueAiVoiceActionConfirmationInput = Readonly<{
  intentId: string
  expectedRevision: number
  payloadHash: string
}>

export type AiVoiceActionConfirmationProof = Readonly<{
  confirmationEventId: string
  confirmationToken: string
  intentId: string
  revision: number
  payloadHash: string
  expiresAt: string
}>

const CONFIRMATION_PROOF_TTL_MS = 60_000

export type AiVoiceActionDraftResponse = Readonly<{
  id: string
  voiceSessionId: string
  actionType: string
  state: string
  revision: number
  payloadHash: string
  preview: unknown
  warnings: unknown
  target: Readonly<{ entityType: string; id: string }> | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  replayed: boolean
}>

function serializeIntent(intent: StoredIntent, replayed: boolean): AiVoiceActionDraftResponse {
  return {
    id: intent.id,
    voiceSessionId: intent.voiceSessionId,
    actionType: intent.actionType,
    state: intent.state,
    revision: intent.revision,
    payloadHash: intent.payloadHash,
    preview: intent.preview,
    warnings: intent.warnings,
    target: intent.targetEntityType && intent.targetEntityId
      ? { entityType: intent.targetEntityType, id: intent.targetEntityId }
      : null,
    expiresAt: intent.expiresAt.toISOString(),
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
    replayed,
  }
}

async function findOwnedIntent(auth: AuthResult, intentId: string): Promise<StoredIntent> {
  const intent = await prisma.aiActionIntent.findFirst({
    where: {
      id: intentId,
      organizationId: auth.orgId,
      userId: auth.userId,
      parentIntentId: null,
    },
  }) as StoredIntent | null
  if (!intent) {
    throw new AiVoiceActionDraftError("INTENT_NOT_FOUND", "The action draft was not found", 404)
  }
  return intent
}

async function assertActiveVoiceSession(
  auth: AuthResult,
  voiceSessionId: string,
): Promise<void> {
  const session = await prisma.voiceSession.findFirst({
    where: {
      id: voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  })
  if (!session) {
    throw new AiVoiceActionDraftError(
      "VOICE_SESSION_INACTIVE",
      "The voice session is not active",
      409,
    )
  }
}

async function expireIntent(intent: StoredIntent, now: Date): Promise<void> {
  await prisma.aiActionIntent.updateMany({
    where: {
      id: intent.id,
      organizationId: intent.organizationId,
      userId: intent.userId,
      state: { in: [...ACTIVE_DRAFT_STATES] },
      revision: intent.revision,
      expiresAt: { lte: now },
    },
    data: { state: "expired", completedAt: now },
  })
}

function hashConfirmationToken(token: string): string {
  return createHash("sha256")
    .update("leaddrive:ai-action-confirmation:v1\n", "utf8")
    .update(token, "utf8")
    .digest("hex")
}

function firstPayloadIssue(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): AiVoiceActionDraftError {
  const issue = issues[0]
  return new AiVoiceActionDraftError(
    "INVALID_ACTION_PAYLOAD",
    issue?.message ?? "Invalid action payload",
    400,
    {
      issues: issues.map((candidate) => ({
        path: candidate.path.map(String),
        message: candidate.message,
      })),
    },
  )
}

function sameRawRequest(existing: StoredIntent, input: CreateAiVoiceActionDraftInput): boolean {
  try {
    return existing.voiceSessionId === input.voiceSessionId
      && existing.actionType === input.actionType
      && canonicalizeAiActionIntentJson(existing.rawPayload)
        === canonicalizeAiActionIntentJson(input.payload)
  } catch {
    return false
  }
}

async function findReplay(
  auth: AuthResult,
  input: CreateAiVoiceActionDraftInput,
): Promise<StoredIntent | null> {
  const byIdempotency = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      idempotencyKey: input.idempotencyKey,
    },
  }) as StoredIntent | null

  const byProviderCall = input.providerToolCallId
    ? await prisma.aiActionIntent.findFirst({
        where: {
          organizationId: auth.orgId,
          userId: auth.userId,
          voiceSessionId: input.voiceSessionId,
          providerToolCallId: input.providerToolCallId,
        },
      }) as StoredIntent | null
    : null

  if (byIdempotency && byProviderCall && byIdempotency.id !== byProviderCall.id) {
    throw new AiVoiceActionDraftError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key and provider tool call refer to different drafts",
      409,
    )
  }

  const existing = byIdempotency ?? byProviderCall
  if (!existing) return null
  if (!sameRawRequest(existing, input)) {
    throw new AiVoiceActionDraftError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key or provider tool call was already used for another draft",
      409,
    )
  }
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new AiVoiceActionDraftError("INTENT_EXPIRED", "The existing draft has expired", 409)
  }
  return existing
}

async function assertActionAccess(
  auth: AuthResult,
  actionType: AiVoiceActionType,
  payload: JsonObject,
): Promise<void> {
  const definition = getAiVoiceActionDefinition(actionType)
  const org = await getOrgModuleContext(auth.orgId)
  for (const permission of definition.permissions) {
    if (
      !checkPermission(auth.role, permission.module, permission.action)
      || !hasModule(org, permission.tenantModule)
    ) {
      throw new AiVoiceActionDraftError(
        "ACTION_FORBIDDEN",
        "The requested CRM action is not available to this user",
        403,
      )
    }
  }

  const requestedFields = [...new Set(definition.fieldPermissionNames(payload))]
  if (requestedFields.length === 0 || auth.role === "admin" || auth.role === "superadmin") return

  let permissionRows: Array<{ fieldName: string; access: string }>
  try {
    permissionRows = await prisma.fieldPermission.findMany({
      where: {
        organizationId: auth.orgId,
        roleId: auth.role,
        entityType: definition.fieldPermissionEntity,
        fieldName: { in: requestedFields },
      },
      select: { fieldName: true, access: true },
    })
  } catch {
    throw new AiVoiceActionDraftError(
      "FIELD_PERMISSION_UNAVAILABLE",
      "Field permissions could not be verified",
      503,
    )
  }
  const forbidden = permissionRows
    .filter((row) => row.access === "hidden" || row.access === "visible")
    .map((row) => row.fieldName)
  if (forbidden.length > 0) {
    throw new AiVoiceActionDraftError(
      "FORBIDDEN_FIELD",
      "One or more fields are not editable",
      403,
      { fields: forbidden },
    )
  }
}

type LeadDraftTarget = Readonly<{
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  phoneWhatsApp: string | null
  telegramHandle: string | null
  sourceDetail: string | null
  interest: string | null
  brand: string | null
  category: string | null
  status: string
  priority: string
  assignedTo: string | null
  estimatedValue: number | null
  notes: string | null
  pipelineId: string | null
  updatedAt: Date
}>

async function resolveLeadTarget(
  auth: AuthResult,
  targetEntityId: string,
): Promise<LeadDraftTarget> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "lead", {
    id: targetEntityId,
    organizationId: auth.orgId,
  })
  const lead = await prisma.lead.findFirst({
    where,
    select: {
      id: true,
      contactName: true,
      companyName: true,
      email: true,
      phone: true,
      phoneWhatsApp: true,
      telegramHandle: true,
      sourceDetail: true,
      interest: true,
      brand: true,
      category: true,
      status: true,
      priority: true,
      assignedTo: true,
      estimatedValue: true,
      notes: true,
      pipelineId: true,
      updatedAt: true,
    },
  })
  if (!lead) {
    throw new AiVoiceActionDraftError("TARGET_NOT_FOUND", "The target record was not found", 404)
  }
  return lead
}

async function assertReplayTargetAccess(
  auth: AuthResult,
  existing: StoredIntent,
): Promise<void> {
  if (!existing.targetEntityType && !existing.targetEntityId) return
  if (existing.targetEntityType !== "lead" || !existing.targetEntityId) {
    throw new AiVoiceActionDraftError(
      "INVALID_STORED_TARGET",
      "The stored draft target is invalid",
      409,
    )
  }
  const target = await resolveLeadTarget(auth, existing.targetEntityId)
  if (
    existing.expectedUpdatedAt
    && target.updatedAt.getTime() !== existing.expectedUpdatedAt.getTime()
  ) {
    throw new AiVoiceActionDraftError(
      "STALE_TARGET",
      "The target record changed after the draft was prepared",
      409,
    )
  }
}

function targetPreviewContext(lead: LeadDraftTarget): AiVoiceActionPreviewContext {
  const before: JsonObject = { ...lead }
  delete before.id
  delete before.updatedAt
  return {
    target: {
      entityType: "lead",
      id: lead.id,
      label: lead.contactName,
      before,
    },
  }
}

async function bindTarget(
  auth: AuthResult,
  input: CreateAiVoiceActionDraftInput,
  normalizedPayload: JsonObject,
): Promise<{
  normalizedPayload: JsonObject
  targetEntityType: "lead" | null
  targetEntityId: string | null
  expectedUpdatedAt: Date | null
  previewContext?: AiVoiceActionPreviewContext
}> {
  const definition = getAiVoiceActionDefinition(input.actionType)
  if (!definition.target) {
    if (input.targetEntityId !== undefined) {
      throw new AiVoiceActionDraftError(
        "UNEXPECTED_TARGET",
        "This action does not accept a target record",
        400,
      )
    }
    return {
      normalizedPayload,
      targetEntityType: null,
      targetEntityId: null,
      expectedUpdatedAt: null,
    }
  }

  if (!input.targetEntityId) {
    throw new AiVoiceActionDraftError(
      "TARGET_REQUIRED",
      "A target record is required for this action",
      400,
    )
  }
  const lead = await resolveLeadTarget(auth, input.targetEntityId)
  if (input.actionType === "convert_lead_to_deal" && lead.status === "converted") {
    throw new AiVoiceActionDraftError(
      "TARGET_ALREADY_CONVERTED",
      "The lead has already been converted",
      409,
    )
  }

  const requestedVersion = typeof normalizedPayload.expectedUpdatedAt === "string"
    ? new Date(normalizedPayload.expectedUpdatedAt)
    : null
  if (requestedVersion && requestedVersion.getTime() !== lead.updatedAt.getTime()) {
    throw new AiVoiceActionDraftError(
      "STALE_TARGET",
      "The target record changed before the draft was prepared",
      409,
    )
  }
  const expectedUpdatedAt = lead.updatedAt
  return {
    normalizedPayload: {
      ...normalizedPayload,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    },
    targetEntityType: "lead",
    targetEntityId: lead.id,
    expectedUpdatedAt,
    previewContext: targetPreviewContext(lead),
  }
}

function phoneVariants(...values: Array<unknown>): string[] {
  const variants = new Set<string>()
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : ""
    if (!trimmed) continue
    const digits = trimmed.replace(/\D/g, "")
    variants.add(trimmed)
    if (!digits) continue
    variants.add(digits)
    variants.add(`+${digits}`)
    const local = azerbaijaniLocalPart(digits)
    if (local) {
      variants.add(`0${local}`)
      variants.add(`994${local}`)
      variants.add(`+994${local}`)
    }
  }
  return [...variants]
}

async function duplicateWarnings(
  auth: AuthResult,
  actionType: AiVoiceActionType,
  payload: JsonObject,
): Promise<unknown[]> {
  if (actionType === "create_lead") {
    const email = typeof payload.email === "string" ? payload.email.trim() : ""
    const phones = phoneVariants(payload.phone, payload.phoneWhatsApp)
    const phoneDigits = phones.map((value) => value.replace(/\D/g, "")).filter(Boolean)
    const last9 = phoneDigits.find((value) => value.length >= 9)?.slice(-9)
    const or: Prisma.LeadWhereInput[] = []
    if (email) or.push({ email: { equals: email, mode: "insensitive" } })
    if (phones.length > 0) {
      or.push({ phone: { in: phones } }, { phoneWhatsApp: { in: phones } })
    }
    if (last9) {
      or.push({ phone: { contains: last9 } }, { phoneWhatsApp: { contains: last9 } })
    }
    if (or.length === 0) return []
    const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "lead", {
      organizationId: auth.orgId,
      OR: or,
    })
    const candidates = await prisma.lead.findMany({
      where,
      select: {
        id: true,
        contactName: true,
        companyName: true,
        email: true,
        phone: true,
        phoneWhatsApp: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    })
    return candidates.length > 0 ? [{ code: "POSSIBLE_DUPLICATE", candidates }] : []
  }

  if (actionType === "create_deal") {
    const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "deal", {
      organizationId: auth.orgId,
      name: { equals: String(payload.name), mode: "insensitive" },
      ...(typeof payload.companyId === "string" ? { companyId: payload.companyId } : {}),
      ...(typeof payload.contactId === "string" ? { contactId: payload.contactId } : {}),
    })
    const candidates = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        name: true,
        companyId: true,
        contactId: true,
        stage: true,
        valueAmount: true,
        currency: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    })
    const safeCandidates = candidates.map((candidate: {
      id: string
      name: string
      companyId: string | null
      contactId: string | null
      stage: string
      valueAmount: unknown
      currency: string
    }) => ({
      ...candidate,
      valueAmount: typeof candidate.valueAmount === "number"
        ? candidate.valueAmount
        : Number(candidate.valueAmount),
    }))
    return safeCandidates.length > 0
      ? [{ code: "POSSIBLE_DUPLICATE", candidates: safeCandidates }]
      : []
  }

  return []
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002")
}

export async function createAiVoiceActionDraft(
  auth: AuthResult,
  input: CreateAiVoiceActionDraftInput,
): Promise<AiVoiceActionDraftResponse> {
  const parsed = parseAiVoiceActionPayload(input.actionType, input.payload)
  if (!parsed.success) throw firstPayloadIssue(parsed.issues)
  if (
    input.actionType === "update_lead"
    && Object.keys(parsed.data).every((field) => field === "expectedUpdatedAt")
  ) {
    throw new AiVoiceActionDraftError(
      "EMPTY_UPDATE",
      "At least one lead field must be changed",
      400,
    )
  }

  await assertActionAccess(auth, input.actionType, parsed.data)

  const replay = await findReplay(auth, input)
  if (replay) {
    await assertReplayTargetAccess(auth, replay)
    return serializeIntent(replay, true)
  }

  const now = new Date()
  await assertActiveVoiceSession(auth, input.voiceSessionId)

  const bound = await bindTarget(auth, input, parsed.data)
  const definition = getAiVoiceActionDefinition(input.actionType)
  const warnings = await duplicateWarnings(auth, input.actionType, bound.normalizedPayload)
  const revision = 1
  const payloadHash = hashAiActionIntentPayload({
    actionType: input.actionType,
    revision,
    normalizedPayload: bound.normalizedPayload,
  })
  const preview = definition.renderPreview(bound.normalizedPayload, bound.previewContext)

  await prisma.aiActionIntent.updateMany({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId: input.voiceSessionId,
      parentIntentId: null,
      state: { in: [...ACTIVE_DRAFT_STATES] },
      expiresAt: { lte: now },
    },
    data: { state: "expired", completedAt: now },
  })

  const active = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId: input.voiceSessionId,
      parentIntentId: null,
      state: { in: ["collecting", "awaiting_confirmation", "executing"] },
    },
    select: { id: true },
  })
  if (active) {
    throw new AiVoiceActionDraftError(
      "ACTIVE_INTENT_EXISTS",
      "This voice session already has an active action draft",
      409,
      { activeIntentId: active.id },
    )
  }

  try {
    const created = await prisma.aiActionIntent.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.userId,
        voiceSessionId: input.voiceSessionId,
        actionType: input.actionType,
        rawPayload: input.payload as Prisma.InputJsonValue,
        normalizedPayload: bound.normalizedPayload as Prisma.InputJsonValue,
        preview: preview as unknown as Prisma.InputJsonValue,
        warnings: warnings as Prisma.InputJsonValue,
        state: "awaiting_confirmation",
        revision,
        payloadHash,
        idempotencyKey: input.idempotencyKey,
        providerToolCallId: input.providerToolCallId,
        targetEntityType: bound.targetEntityType,
        targetEntityId: bound.targetEntityId,
        expectedUpdatedAt: bound.expectedUpdatedAt,
        expiresAt: aiActionIntentExpiresAt(now, definition.ttlMs),
      },
    }) as StoredIntent

    void logAudit(auth.orgId, "voice_action_drafted", "ai_action_intent", created.id, undefined, {
      userId: auth.userId,
      newValue: {
        actionType: input.actionType,
        voiceSessionId: input.voiceSessionId,
        revision,
      },
    })
    return serializeIntent(created, false)
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const concurrentReplay = await findReplay(auth, input)
    if (concurrentReplay) return serializeIntent(concurrentReplay, true)
    const concurrentActive = await prisma.aiActionIntent.findFirst({
      where: {
        organizationId: auth.orgId,
        userId: auth.userId,
        voiceSessionId: input.voiceSessionId,
        parentIntentId: null,
        state: { in: ["collecting", "awaiting_confirmation", "executing"] },
      },
      select: { id: true },
    })
    throw new AiVoiceActionDraftError(
      "ACTIVE_INTENT_EXISTS",
      "This voice session already has an active action draft",
      409,
      concurrentActive ? { activeIntentId: concurrentActive.id } : undefined,
    )
  }
}

/**
 * Replace the payload of an unconfirmed receipt. The expected revision is a
 * compare-and-swap token: concurrent edits cannot silently overwrite each
 * other and a retry of the exact same edit returns the stored revision.
 */
export async function updateAiVoiceActionDraft(
  auth: AuthResult,
  input: UpdateAiVoiceActionDraftInput,
): Promise<AiVoiceActionDraftResponse> {
  const existing = await findOwnedIntent(auth, input.intentId)
  if (!isAiVoiceActionType(existing.actionType)) {
    throw new AiVoiceActionDraftError("INVALID_STORED_ACTION", "The stored action is invalid", 409)
  }
  if (existing.state !== "awaiting_confirmation") {
    throw new AiVoiceActionDraftError(
      "INTENT_NOT_EDITABLE",
      "Only an unconfirmed action draft can be edited",
      409,
      { state: existing.state },
    )
  }

  const now = new Date()
  if (existing.expiresAt.getTime() <= now.getTime()) {
    await expireIntent(existing, now)
    throw new AiVoiceActionDraftError("INTENT_EXPIRED", "The action draft has expired", 409)
  }

  const parsed = parseAiVoiceActionPayload(existing.actionType, input.payload)
  if (!parsed.success) throw firstPayloadIssue(parsed.issues)
  if (
    existing.actionType === "update_lead"
    && Object.keys(parsed.data).every((field) => field === "expectedUpdatedAt")
  ) {
    throw new AiVoiceActionDraftError(
      "EMPTY_UPDATE",
      "At least one lead field must be changed",
      400,
    )
  }

  if (existing.revision === input.expectedRevision + 1) {
    try {
      if (
        canonicalizeAiActionIntentJson(existing.rawPayload)
        === canonicalizeAiActionIntentJson(input.payload)
      ) {
        await assertActionAccess(auth, existing.actionType, parsed.data)
        await assertReplayTargetAccess(auth, existing)
        return serializeIntent(existing, true)
      }
    } catch (error) {
      if (error instanceof AiVoiceActionDraftError) throw error
    }
  }
  if (existing.revision !== input.expectedRevision) {
    throw new AiVoiceActionDraftError(
      "REVISION_CONFLICT",
      "The action draft was changed by another request",
      409,
      { currentRevision: existing.revision },
    )
  }

  await assertActiveVoiceSession(auth, existing.voiceSessionId)
  await assertActionAccess(auth, existing.actionType, parsed.data)
  await assertReplayTargetAccess(auth, existing)
  const bound = await bindTarget(auth, {
    voiceSessionId: existing.voiceSessionId,
    actionType: existing.actionType,
    payload: input.payload,
    idempotencyKey: "edit-does-not-replace-root-idempotency-key",
    ...(existing.targetEntityId ? { targetEntityId: existing.targetEntityId } : {}),
  }, parsed.data)
  const definition = getAiVoiceActionDefinition(existing.actionType)
  const revision = existing.revision + 1
  const warnings = await duplicateWarnings(auth, existing.actionType, bound.normalizedPayload)
  const preview = definition.renderPreview(bound.normalizedPayload, bound.previewContext)
  const payloadHash = hashAiActionIntentPayload({
    actionType: existing.actionType,
    revision,
    normalizedPayload: bound.normalizedPayload,
  })
  const expiresAt = aiActionIntentExpiresAt(now, definition.ttlMs)

  const changed = await prisma.aiActionIntent.updateMany({
    where: {
      id: existing.id,
      organizationId: auth.orgId,
      userId: auth.userId,
      state: "awaiting_confirmation",
      revision: input.expectedRevision,
      expiresAt: { gt: now },
    },
    data: {
      rawPayload: input.payload as Prisma.InputJsonValue,
      normalizedPayload: bound.normalizedPayload as Prisma.InputJsonValue,
      preview: preview as unknown as Prisma.InputJsonValue,
      warnings: warnings as Prisma.InputJsonValue,
      revision,
      payloadHash,
      expectedUpdatedAt: bound.expectedUpdatedAt,
      expiresAt,
    },
  })
  if (changed.count !== 1) {
    throw new AiVoiceActionDraftError(
      "REVISION_CONFLICT",
      "The action draft was changed by another request",
      409,
    )
  }

  const updated = await findOwnedIntent(auth, existing.id)
  void logAudit(auth.orgId, "voice_action_draft_updated", "ai_action_intent", existing.id, undefined, {
    userId: auth.userId,
    newValue: { actionType: existing.actionType, revision },
  })
  return serializeIntent(updated, false)
}

/** Return the caller's only active root receipt for one owned voice session. */
export async function getActiveAiVoiceActionDraft(
  auth: AuthResult,
  voiceSessionId: string,
): Promise<AiVoiceActionDraftResponse | null> {
  await assertActiveVoiceSession(auth, voiceSessionId)
  const now = new Date()
  await prisma.aiActionIntent.updateMany({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId,
      parentIntentId: null,
      state: { in: [...ACTIVE_DRAFT_STATES] },
      expiresAt: { lte: now },
    },
    data: { state: "expired", completedAt: now },
  })
  const active = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId,
      parentIntentId: null,
      state: { in: ["collecting", "awaiting_confirmation", "executing"] },
    },
  }) as StoredIntent | null
  if (!active) return null
  if (!isAiVoiceActionType(active.actionType)) {
    throw new AiVoiceActionDraftError("INVALID_STORED_ACTION", "The stored action is invalid", 409)
  }
  const parsed = parseAiVoiceActionPayload(active.actionType, active.rawPayload)
  if (!parsed.success) {
    throw new AiVoiceActionDraftError("INVALID_STORED_PAYLOAD", "The stored action is invalid", 409)
  }
  await assertActionAccess(auth, active.actionType, parsed.data)
  await assertReplayTargetAccess(auth, active)
  return serializeIntent(active, false)
}

/** Cancel an unconfirmed receipt without invoking any CRM command. */
export async function cancelAiVoiceActionDraft(
  auth: AuthResult,
  input: CancelAiVoiceActionDraftInput,
): Promise<AiVoiceActionDraftResponse> {
  const existing = await findOwnedIntent(auth, input.intentId)
  if (existing.state === "cancelled") return serializeIntent(existing, true)
  if (existing.state !== "collecting" && existing.state !== "awaiting_confirmation") {
    throw new AiVoiceActionDraftError(
      "INTENT_NOT_CANCELLABLE",
      "The action draft can no longer be cancelled",
      409,
      { state: existing.state },
    )
  }
  const now = new Date()
  if (existing.expiresAt.getTime() <= now.getTime()) {
    await expireIntent(existing, now)
    throw new AiVoiceActionDraftError("INTENT_EXPIRED", "The action draft has expired", 409)
  }
  if (existing.revision !== input.expectedRevision) {
    throw new AiVoiceActionDraftError(
      "REVISION_CONFLICT",
      "The action draft was changed by another request",
      409,
      { currentRevision: existing.revision },
    )
  }
  const changed = await prisma.aiActionIntent.updateMany({
    where: {
      id: existing.id,
      organizationId: auth.orgId,
      userId: auth.userId,
      state: { in: ["collecting", "awaiting_confirmation"] },
      revision: input.expectedRevision,
      expiresAt: { gt: now },
    },
    data: { state: "cancelled", completedAt: now },
  })
  if (changed.count !== 1) {
    throw new AiVoiceActionDraftError(
      "REVISION_CONFLICT",
      "The action draft was changed by another request",
      409,
    )
  }
  const cancelled = await findOwnedIntent(auth, existing.id)
  void logAudit(auth.orgId, "voice_action_cancelled", "ai_action_intent", existing.id, undefined, {
    userId: auth.userId,
    newValue: { actionType: existing.actionType, revision: existing.revision },
  })
  return serializeIntent(cancelled, false)
}

/**
 * Mint a short-lived, one-time proof for an explicit receipt-button action.
 * The raw token is returned once and never persisted. This function still
 * cannot execute a CRM command or move the intent into `executing`.
 */
export async function issueAiVoiceActionConfirmationProof(
  auth: AuthResult,
  input: IssueAiVoiceActionConfirmationInput,
): Promise<AiVoiceActionConfirmationProof> {
  const existing = await findOwnedIntent(auth, input.intentId)
  if (!isAiVoiceActionType(existing.actionType)) {
    throw new AiVoiceActionDraftError("INVALID_STORED_ACTION", "The stored action is invalid", 409)
  }
  if (existing.state !== "awaiting_confirmation") {
    throw new AiVoiceActionDraftError(
      "INTENT_NOT_CONFIRMABLE",
      "Only an unconfirmed action draft can be confirmed",
      409,
      { state: existing.state },
    )
  }

  const now = new Date()
  if (existing.expiresAt.getTime() <= now.getTime()) {
    await expireIntent(existing, now)
    throw new AiVoiceActionDraftError("INTENT_EXPIRED", "The action draft has expired", 409)
  }
  if (existing.revision !== input.expectedRevision || existing.payloadHash !== input.payloadHash) {
    throw new AiVoiceActionDraftError(
      "CONFIRMATION_MISMATCH",
      "The reviewed action no longer matches the current draft",
      409,
      { currentRevision: existing.revision, currentPayloadHash: existing.payloadHash },
    )
  }

  const calculatedHash = hashAiActionIntentPayload({
    actionType: existing.actionType,
    revision: existing.revision,
    normalizedPayload: existing.normalizedPayload,
  })
  if (calculatedHash !== existing.payloadHash) {
    throw new AiVoiceActionDraftError(
      "INTENT_INTEGRITY_FAILED",
      "The action draft could not be verified",
      409,
    )
  }

  const parsed = parseAiVoiceActionPayload(existing.actionType, existing.rawPayload)
  if (!parsed.success) {
    throw new AiVoiceActionDraftError("INVALID_STORED_PAYLOAD", "The stored action is invalid", 409)
  }
  await assertActiveVoiceSession(auth, existing.voiceSessionId)
  await assertActionAccess(auth, existing.actionType, parsed.data)
  await assertReplayTargetAccess(auth, existing)

  const confirmationToken = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now.getTime() + CONFIRMATION_PROOF_TTL_MS)
  const event = await prisma.aiActionIntentEvent.create({
    data: {
      organizationId: auth.orgId,
      intentId: existing.id,
      userId: auth.userId,
      eventType: "confirmation_proof_issued",
      intentRevision: existing.revision,
      payloadHash: existing.payloadHash,
      eventData: {
        tokenHash: hashConfirmationToken(confirmationToken),
        expiresAt: expiresAt.toISOString(),
      },
    },
    select: { id: true },
  })

  return {
    confirmationEventId: event.id,
    confirmationToken,
    intentId: existing.id,
    revision: existing.revision,
    payloadHash: existing.payloadHash,
    expiresAt: expiresAt.toISOString(),
  }
}
