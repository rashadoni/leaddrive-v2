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
  voiceSessionId: string
  actionType: string
  rawPayload: unknown
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
    const safeCandidates = candidates.map((candidate) => ({
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
  const session = await prisma.voiceSession.findFirst({
    where: {
      id: input.voiceSessionId,
      organizationId: auth.orgId,
      userId: auth.userId,
      status: "active",
      expiresAt: { gt: now },
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
      actionType: input.actionType,
      voiceSessionId: input.voiceSessionId,
      revision,
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
