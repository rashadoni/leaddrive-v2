import { createHash, randomBytes } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { AuthResult } from "@/lib/api-auth"
import { getOrgModuleContext } from "@/lib/api-auth"
import { moduleContextForUser } from "@/lib/user-module-access"
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
  type AiVoiceActionPreview,
  type AiVoiceActionPreviewContext,
  type AiVoiceActionTargetType,
  type AiVoiceActionType,
} from "./action-registry"

type JsonObject = Record<string, unknown>

const ACTIVE_DRAFT_STATES = ["collecting", "awaiting_confirmation"] as const
type DraftLifecycleEventType = "drafted" | "draft_updated" | "cancelled" | "expired" | "failed"

/**
 * Исполнение, которое начали и не закончили. Код намеренно отличается от
 * ошибок самой CRM-команды: он означает «до записи дело не дошло».
 */
const EXECUTION_ABANDONED_ERROR_CODE = "EXECUTION_ABANDONED"

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
  executionLeaseExpiresAt: Date | null
  errorCode: string | null
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

export type RevalidateAiVoiceActionExecutionInput = Readonly<{
  intentId: string
  expectedRevision: number
  payloadHash: string
  expectedState: "awaiting_confirmation" | "executing"
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
  /** Черновик, который этот заменил: поправка пользователя, а не второй черновик. */
  supersededIntentId?: string
}>

function serializeIntent(
  intent: StoredIntent,
  replayed: boolean,
  supersededIntentId: string | null = null,
): AiVoiceActionDraftResponse {
  return {
    ...(supersededIntentId ? { supersededIntentId } : {}),
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

async function appendDraftLifecycleEvent(
  tx: Prisma.TransactionClient,
  intent: Pick<StoredIntent, "id" | "organizationId" | "userId" | "revision" | "payloadHash">,
  eventType: DraftLifecycleEventType,
  eventData: Prisma.InputJsonObject,
): Promise<void> {
  await tx.aiActionIntentEvent.create({
    data: {
      organizationId: intent.organizationId,
      intentId: intent.id,
      userId: intent.userId,
      eventType,
      intentRevision: intent.revision,
      payloadHash: intent.payloadHash,
      eventData,
    },
  })
}

async function expireIntent(intent: StoredIntent, now: Date): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const changed = await tx.aiActionIntent.updateMany({
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
    if (changed.count !== 1) return false
    await appendDraftLifecycleEvent(tx, intent, "expired", {
      fromState: intent.state,
      reason: "ttl_elapsed",
    })
    return true
  })
}

/**
 * Брошенное исполнение — тоже конец, и у него теперь есть хозяин.
 *
 * Тот же класс, что и забытый черновик (см. `cancelUnfinishedSessionDrafts`), и
 * последнее его место. Состояние `executing` нигде не закрывалось: заменять его
 * нельзя (вторая запись в CRM — дубль), срок жизни черновика к нему не
 * применялся, крон о нём не знал, а крестик на него не действовал. Если браузер
 * ушёл между заявкой на исполнение и результатом — упал процесс при деплое,
 * порвалась сеть, закрыли вкладку, — запись оставалась `executing` НАВСЕГДА.
 * Через минуту, когда истекала лиза, каждая следующая просьба в этом разговоре
 * получала «предыдущее действие выполняется прямо сейчас» — утверждение,
 * которое к этому моменту уже было ложью.
 *
 * Закрывается именно как `failed`, и это не домысел: CRM-мутация, результат и
 * событие `succeeded` лежат в ОДНОЙ транзакции (`executeClaimedAiVoiceAction`),
 * поэтому незакрытая заявка значит, что в CRM не записано ничего. Не
 * «неизвестно, записалось ли» — ничего.
 *
 * Живую лизу это не трогает: пока её срок не истёк, исполнение идёт, и
 * восстановить его может только тот, кто его начал (`recoverExpiredLease`).
 */
async function abandonExpiredExecution(intent: StoredIntent, now: Date): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const changed = await tx.aiActionIntent.updateMany({
      where: {
        id: intent.id,
        organizationId: intent.organizationId,
        userId: intent.userId,
        state: "executing",
        revision: intent.revision,
        executionLeaseExpiresAt: { lte: now },
      },
      data: {
        state: "failed",
        errorCode: EXECUTION_ABANDONED_ERROR_CODE,
        completedAt: now,
      },
    })
    if (changed.count !== 1) return false
    await appendDraftLifecycleEvent(tx, intent, "failed", {
      fromState: "executing",
      reason: "execution_lease_expired",
      errorCode: EXECUTION_ABANDONED_ERROR_CODE,
    })
    return true
  })
}

/**
 * Пользователь поправил себя — черновик на экране заменяется новым.
 *
 * Почему это не «ещё один черновик». Сессия держит ровно один незавершённый
 * черновик, и так и должно быть: двух квитанций на экране не бывает. Но
 * инструкция ассистенту прямо велит на поправку («добавь цену», «нет, телефон
 * другой») готовить НОВЫЙ черновик — и упиралась в тот же запрет. Владелец
 * 2026-11-05: попросил добавить цену к сделке — сделка не создалась; следом не
 * создался и лид, «какой-то процесс занят». Это был один и тот же висящий
 * черновик.
 *
 * Поэтому незавершённый черновик отменяется в пользу нового. Отмена, а не
 * удаление: в журнале остаётся запись `superseded_by_draft`, по которой видно,
 * что заменило и чем.
 *
 * Черновик в состоянии `executing` НЕ заменяется: его уже исполняют, и вторая
 * запись в CRM — это не поправка, а дубль.
 */
async function supersedeOwnedSessionDraft(
  active: Pick<StoredIntent, "id" | "organizationId" | "userId" | "revision" | "payloadHash" | "state">,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const changed = await tx.aiActionIntent.updateMany({
      where: {
        id: active.id,
        organizationId: active.organizationId,
        userId: active.userId,
        // Гонка: если черновик за эти миллисекунды ушёл в исполнение, замена
        // не состоится и вызывающий получит честный отказ.
        state: { in: ["collecting", "awaiting_confirmation"] },
        revision: active.revision,
      },
      data: { state: "cancelled", completedAt: now },
    })
    if (changed.count !== 1) return false
    await appendDraftLifecycleEvent(tx, active, "cancelled", {
      fromState: active.state,
      reason: "superseded_by_draft",
    })
    return true
  })
}

/**
 * Разговор кончился — кончился и его черновик.
 *
 * КОРЕНЬ класса проблем, ради которого это написано (владелец, 2026-11-05:
 * «надо найти корень таких типов проблем»). Черновик жил как состояние
 * СЕССИИ, у которого не было хозяина конца: завершить его могли только две
 * вещи — пользователь нажал «Отменить» или истёк срок. Всё остальное его не
 * трогало: закрытие квитанции крестиком прятало её только на экране, конец
 * разговора и крон-уборщик брошенных сессий про черновики не знали вовсе.
 *
 * А «не всякая задача должна выполняться» (владелец там же): человек передумал
 * на полуслове — и в сессии оставалась невидимая запись, которую он не мог ни
 * увидеть, ни убрать обычными словами. Она же потом отказывала в следующей
 * просьбе кодом, который никто не понимал.
 *
 * Поэтому у конца теперь есть хозяин: тот, кто закрывает разговор, закрывает и
 * незавершённый черновик. Состояние `executing` не трогается — его уже
 * исполняют, и отмена на полпути создала бы запись без квитанции.
 *
 * Отменяется, а не удаляется: в журнале остаётся, почему черновик закончился.
 */
export async function cancelUnfinishedSessionDrafts(
  organizationId: string,
  voiceSessionId: string,
  reason: "session_ended" | "session_abandoned",
  now: Date = new Date(),
): Promise<number> {
  const drafts = await prisma.aiActionIntent.findMany({
    where: {
      organizationId,
      voiceSessionId,
      parentIntentId: null,
      state: { in: ["collecting", "awaiting_confirmation"] },
    },
    select: { id: true, organizationId: true, userId: true, revision: true, payloadHash: true, state: true },
  })
  let cancelled = 0
  for (const draft of drafts) {
    const done = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.aiActionIntent.updateMany({
        where: {
          id: draft.id,
          organizationId: draft.organizationId,
          state: { in: ["collecting", "awaiting_confirmation"] },
          revision: draft.revision,
        },
        data: { state: "cancelled", completedAt: now },
      })
      if (changed.count !== 1) return false
      await appendDraftLifecycleEvent(tx, draft, "cancelled", { fromState: draft.state, reason })
      return true
    })
    if (done) cancelled += 1
  }

  // Брошенное исполнение закрывается здесь же: конец разговора — это конец
  // всего, что разговор держал. Живая лиза не трогается.
  const abandoned = await prisma.aiActionIntent.findMany({
    where: {
      organizationId,
      voiceSessionId,
      parentIntentId: null,
      state: "executing",
      executionLeaseExpiresAt: { lte: now },
    },
  }) as StoredIntent[]
  for (const intent of abandoned) {
    if (await abandonExpiredExecution(intent, now)) cancelled += 1
  }
  return cancelled
}

/**
 * Закрыть то, что в этом разговоре уже кончилось: просроченный черновик и
 * брошенное исполнение. Вызывается перед каждым чтением и каждой записью, чтобы
 * ни одна просьба не упёрлась в состояние, которого уже нет.
 */
async function endOwnedSessionDraftIfOver(
  auth: AuthResult,
  voiceSessionId: string,
  now: Date,
): Promise<void> {
  const expired = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId,
      parentIntentId: null,
      state: { in: [...ACTIVE_DRAFT_STATES] },
      expiresAt: { lte: now },
    },
  }) as StoredIntent | null
  if (expired) await expireIntent(expired, now)

  const abandoned = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId,
      parentIntentId: null,
      state: "executing",
      executionLeaseExpiresAt: { lte: now },
    },
  }) as StoredIntent | null
  if (abandoned) await abandonExpiredExecution(abandoned, now)
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
  const org = moduleContextForUser(await getOrgModuleContext(auth.orgId), auth)
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

/**
 * The record an update draft is bound to, read through the caller's own
 * record filter. `before` holds exactly the fields a receipt can show, in the
 * shape the preview renders; `updatedAt` becomes the draft's optimistic lock.
 */
type DraftTarget = Readonly<{
  entityType: AiVoiceActionTargetType
  id: string
  label: string
  status: string | null
  updatedAt: Date
  before: JsonObject
}>

async function resolveTaskTarget(auth: AuthResult, targetEntityId: string): Promise<DraftTarget> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "task", {
    id: targetEntityId,
    organizationId: auth.orgId,
  })
  const task = await prisma.task.findFirst({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      dueDate: true,
      assignedTo: true,
      status: true,
      updatedAt: true,
    },
  })
  if (!task) {
    throw new AiVoiceActionDraftError("TARGET_NOT_FOUND", "The target record was not found", 404)
  }
  return {
    entityType: "task",
    id: task.id,
    label: task.title,
    status: task.status,
    updatedAt: task.updatedAt,
    before: {
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      assignedTo: task.assignedTo,
      status: task.status,
    },
  }
}

async function resolveDealTarget(auth: AuthResult, targetEntityId: string): Promise<DraftTarget> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "deal", {
    id: targetEntityId,
    organizationId: auth.orgId,
  })
  const deal = await prisma.deal.findFirst({
    where,
    select: {
      id: true,
      name: true,
      companyId: true,
      contactId: true,
      valueAmount: true,
      currency: true,
      expectedClose: true,
      assignedTo: true,
      notes: true,
      stage: true,
      updatedAt: true,
    },
  })
  if (!deal) {
    throw new AiVoiceActionDraftError("TARGET_NOT_FOUND", "The target record was not found", 404)
  }
  return {
    entityType: "deal",
    id: deal.id,
    label: deal.name,
    status: deal.stage,
    updatedAt: deal.updatedAt,
    before: {
      stage: deal.stage,
      name: deal.name,
      companyId: deal.companyId,
      contactId: deal.contactId,
      // Decimal in the database; the receipt compares and prints numbers.
      valueAmount: deal.valueAmount === null || deal.valueAmount === undefined ? null : Number(deal.valueAmount),
      currency: deal.currency,
      expectedClose: deal.expectedClose ? deal.expectedClose.toISOString() : null,
      assignedTo: deal.assignedTo,
      notes: deal.notes,
    },
  }
}

async function resolveLeadDraftTarget(auth: AuthResult, targetEntityId: string): Promise<DraftTarget> {
  const lead = await resolveLeadTarget(auth, targetEntityId)
  const before: JsonObject = { ...lead }
  delete before.id
  delete before.updatedAt
  return {
    entityType: "lead",
    id: lead.id,
    label: lead.contactName,
    status: lead.status,
    updatedAt: lead.updatedAt,
    before,
  }
}

function resolveDraftTarget(
  auth: AuthResult,
  entityType: AiVoiceActionTargetType,
  targetEntityId: string,
): Promise<DraftTarget> {
  if (entityType === "task") return resolveTaskTarget(auth, targetEntityId)
  if (entityType === "deal") return resolveDealTarget(auth, targetEntityId)
  return resolveLeadDraftTarget(auth, targetEntityId)
}

/** Preview fields whose value is an id of another record, and where to name it. */
const REFERENCE_FIELDS: Readonly<Record<string, "user" | "company" | "contact">> = {
  assignedTo: "user",
  companyId: "company",
  contactId: "contact",
}

/**
 * Put names next to the ids a receipt would otherwise print.
 *
 * Read inside the organisation only, never through the model: the ids were
 * resolved by the server, and the names come from the same rows. An id that
 * no longer resolves keeps no label, so the receipt shows it as it is rather
 * than a name that is not true.
 */
async function labelPreviewReferences(
  auth: AuthResult,
  preview: AiVoiceActionPreview,
): Promise<AiVoiceActionPreview> {
  const wanted = { user: new Set<string>(), company: new Set<string>(), contact: new Set<string>() }
  for (const field of preview.fields) {
    const kind = REFERENCE_FIELDS[field.key]
    if (!kind) continue
    for (const value of [field.before, field.after]) {
      if (typeof value === "string" && value) wanted[kind].add(value)
    }
  }
  if (wanted.user.size + wanted.company.size + wanted.contact.size === 0) return preview

  const [users, companies, contacts] = await Promise.all([
    wanted.user.size
      ? prisma.user.findMany({
        where: { organizationId: auth.orgId, id: { in: [...wanted.user] } },
        select: { id: true, name: true, email: true },
      })
      : [],
    wanted.company.size
      ? prisma.company.findMany({
        where: { organizationId: auth.orgId, id: { in: [...wanted.company] } },
        select: { id: true, name: true },
      })
      : [],
    wanted.contact.size
      ? prisma.contact.findMany({
        where: { organizationId: auth.orgId, id: { in: [...wanted.contact] } },
        select: { id: true, fullName: true },
      })
      : [],
  ])
  const names = {
    user: new Map<string, string>(
      (users as { id: string; name: string | null; email: string }[])
        .map((row) => [row.id, row.name?.trim() || row.email]),
    ),
    company: new Map<string, string>(
      (companies as { id: string; name: string }[]).map((row) => [row.id, row.name]),
    ),
    contact: new Map<string, string>(
      (contacts as { id: string; fullName: string }[]).map((row) => [row.id, row.fullName]),
    ),
  }
  return {
    ...preview,
    fields: preview.fields.map((field) => {
      const kind = REFERENCE_FIELDS[field.key]
      if (!kind) return field
      const label = (value: unknown) => (typeof value === "string" ? names[kind].get(value) : undefined)
      const afterLabel = label(field.after)
      const beforeLabel = label(field.before)
      return {
        ...field,
        ...(afterLabel ? { afterLabel } : {}),
        ...(beforeLabel ? { beforeLabel } : {}),
      }
    }),
  }
}

async function assertReplayTargetAccess(
  auth: AuthResult,
  existing: StoredIntent,
): Promise<void> {
  if (!existing.targetEntityType && !existing.targetEntityId) return
  const expectedType = isAiVoiceActionType(existing.actionType)
    ? getAiVoiceActionDefinition(existing.actionType).target?.entityType
    : undefined
  if (!expectedType || existing.targetEntityType !== expectedType || !existing.targetEntityId) {
    throw new AiVoiceActionDraftError(
      "INVALID_STORED_TARGET",
      "The stored draft target is invalid",
      409,
    )
  }
  const target = await resolveDraftTarget(auth, expectedType, existing.targetEntityId)
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

/**
 * Repeat the mutable authorization and target checks immediately before a
 * first execution claim or an expired-lease recovery. It deliberately returns
 * no payload: the atomic claim/executor must re-read the tenant-owned intent.
 */
export async function revalidateAiVoiceActionExecutionAccess(
  auth: AuthResult,
  input: RevalidateAiVoiceActionExecutionInput,
): Promise<void> {
  const existing = await findOwnedIntent(auth, input.intentId)
  if (!isAiVoiceActionType(existing.actionType)) {
    throw new AiVoiceActionDraftError("INVALID_STORED_ACTION", "The stored action is invalid", 409)
  }
  if (existing.state !== input.expectedState) {
    throw new AiVoiceActionDraftError(
      "INTENT_STATE_CHANGED",
      "The action state changed before execution",
      409,
      { state: existing.state },
    )
  }
  if (
    existing.revision !== input.expectedRevision
    || existing.payloadHash !== input.payloadHash
  ) {
    throw new AiVoiceActionDraftError(
      "EXECUTION_IDENTITY_MISMATCH",
      "The reviewed action no longer matches the stored intent",
      409,
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
      "The action intent could not be verified",
      409,
    )
  }
  const parsed = parseAiVoiceActionPayload(existing.actionType, existing.normalizedPayload)
  if (!parsed.success) {
    throw new AiVoiceActionDraftError("INVALID_STORED_PAYLOAD", "The stored action is invalid", 409)
  }
  await assertActiveVoiceSession(auth, existing.voiceSessionId)
  await assertActionAccess(auth, existing.actionType, parsed.data)
  await assertReplayTargetAccess(auth, existing)
}

function targetPreviewContext(target: DraftTarget): AiVoiceActionPreviewContext {
  return {
    target: {
      entityType: target.entityType,
      id: target.id,
      label: target.label,
      before: target.before,
    },
  }
}

async function bindTarget(
  auth: AuthResult,
  input: CreateAiVoiceActionDraftInput,
  normalizedPayload: JsonObject,
): Promise<{
  normalizedPayload: JsonObject
  targetEntityType: AiVoiceActionTargetType | null
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
  const target = await resolveDraftTarget(auth, definition.target.entityType, input.targetEntityId)
  if (input.actionType === "convert_lead_to_deal" && target.status === "converted") {
    throw new AiVoiceActionDraftError(
      "TARGET_ALREADY_CONVERTED",
      "The lead has already been converted",
      409,
    )
  }

  const requestedVersion = typeof normalizedPayload.expectedUpdatedAt === "string"
    ? new Date(normalizedPayload.expectedUpdatedAt)
    : null
  if (requestedVersion && requestedVersion.getTime() !== target.updatedAt.getTime()) {
    throw new AiVoiceActionDraftError(
      "STALE_TARGET",
      "The target record changed before the draft was prepared",
      409,
    )
  }
  const expectedUpdatedAt = target.updatedAt
  return {
    normalizedPayload: {
      ...normalizedPayload,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    },
    targetEntityType: target.entityType,
    targetEntityId: target.id,
    expectedUpdatedAt,
    previewContext: targetPreviewContext(target),
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

/**
 * What the user is about to set off, when a stage move is terminal.
 *
 * Winning a deal is not an edit: it pays cashback to the contacts who have a
 * role on it, sends the customer a satisfaction survey, awards loyalty points
 * and takes the contact out of its cadences. None of that is visible in
 * "stage: NEGOTIATION → WON", so the receipt says it in words.
 */
async function stageMoveWarnings(auth: AuthResult, payload: JsonObject): Promise<unknown[]> {
  const stageName = typeof payload.stage === "string" ? payload.stage : ""
  if (!stageName) return []
  const stage = await prisma.pipelineStage.findFirst({
    where: { organizationId: auth.orgId, name: stageName, isActive: true },
    select: { isWon: true, isLost: true },
  })
  if (stage?.isWon) return [{ code: "DEAL_STAGE_WON" }]
  if (stage?.isLost) return [{ code: "DEAL_STAGE_LOST" }]
  return []
}

async function duplicateWarnings(
  auth: AuthResult,
  actionType: AiVoiceActionType,
  payload: JsonObject,
): Promise<unknown[]> {
  if (actionType === "move_deal_stage") return stageMoveWarnings(auth, payload)
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
  // Повтор того же вызова инструмента — это повтор, а не поправка: проверяется
  // первым, иначе сетевой ретрай правил бы черновик сам себе.
  const earlyReplay = await findReplay(auth, input)
  if (earlyReplay) {
    await assertReplayTargetAccess(auth, earlyReplay)
    return serializeIntent(earlyReplay, true)
  }

  // Поправка к незакрытой задаче решается ДО проверки схемы. «Добавь цену» —
  // это `{ valueAmount }` без имени сделки: по схеме создания оно неполное, а
  // по смыслу это дополнение уже собранного (владелец, 2026-11-05).
  let payload = asJsonObject(input.payload)
  const amendment = await findAmendableDraft(auth, input)
  if (amendment) {
    const merged = { ...asJsonObject(amendment.normalizedPayload), ...payload }
    try {
      return await updateAiVoiceActionDraft(auth, {
        intentId: amendment.id,
        expectedRevision: amendment.revision,
        payload: merged,
      })
    } catch (error) {
      /**
       * Запись изменил кто-то другой, пока квитанция висела на экране.
       *
       * Дополнять нечего: открытый черновик считался от версии, которой больше
       * нет, и подтвердить его нельзя — это правильно, иначе голос затёр бы
       * чужую правку. Но и ОТКАЗЫВАТЬ человеку тут нельзя: он просто повторил
       * фразу, а в ответ получал «запись изменилась» до конца разговора, и
       * единственным выходом был крестик.
       *
       * Поэтому дальше идёт обычный путь: старая квитанция отменяется, новая
       * считается от ЖИВОЙ версии записи, всё сказанное раньше переносится, а
       * версия записи — нет: её ставит сервер по текущей строке. Человек
       * подтверждает то, что видит на новой квитанции.
       */
      if (!(error instanceof AiVoiceActionDraftError) || error.code !== "STALE_TARGET") throw error
      const { expectedUpdatedAt: _staleVersion, ...carried } = merged
      payload = carried
    }
  }

  const parsed = parseAiVoiceActionPayload(input.actionType, payload)
  if (!parsed.success) throw firstPayloadIssue(parsed.issues)
  if (
    getAiVoiceActionDefinition(input.actionType).operation === "update"
    && Object.keys(parsed.data).every((field) => field === "expectedUpdatedAt")
  ) {
    throw new AiVoiceActionDraftError(
      "EMPTY_UPDATE",
      "At least one field must be changed",
      400,
    )
  }

  await assertActionAccess(auth, input.actionType, parsed.data)

  const now = new Date()
  await assertActiveVoiceSession(auth, input.voiceSessionId)

  const bound = await bindTarget(auth, { ...input, payload }, parsed.data)
  const definition = getAiVoiceActionDefinition(input.actionType)
  const warnings = await duplicateWarnings(auth, input.actionType, bound.normalizedPayload)
  const revision = 1
  const payloadHash = hashAiActionIntentPayload({
    actionType: input.actionType,
    revision,
    normalizedPayload: bound.normalizedPayload,
  })
  const preview = await labelPreviewReferences(
    auth,
    definition.renderPreview(bound.normalizedPayload, bound.previewContext),
  )

  await endOwnedSessionDraftIfOver(auth, input.voiceSessionId, now)

  const active = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId: input.voiceSessionId,
      parentIntentId: null,
      state: { in: ["collecting", "awaiting_confirmation", "executing"] },
    },
    select: {
      id: true, organizationId: true, userId: true,
      revision: true, payloadHash: true, state: true,
      actionType: true, targetEntityId: true, normalizedPayload: true,
    },
  })
  let supersededIntentId: string | null = null
  if (active) {
    // Сюда доходит только ДРУГАЯ задача: поправка к той же разобрана выше.
    if (active.state === "executing") {
      throw new AiVoiceActionDraftError(
        "ACTIVE_EXECUTION_IN_PROGRESS",
        "The previous action is being executed right now",
        409,
        { activeIntentId: active.id },
      )
    }
    if (!await supersedeOwnedSessionDraft(active, now)) {
      throw new AiVoiceActionDraftError(
        "ACTIVE_INTENT_EXISTS",
        "This voice session already has an active action draft",
        409,
        { activeIntentId: active.id },
      )
    }
    supersededIntentId = active.id
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const intent = await tx.aiActionIntent.create({
        data: {
          organizationId: auth.orgId,
          userId: auth.userId,
          voiceSessionId: input.voiceSessionId,
          actionType: input.actionType,
          rawPayload: payload as Prisma.InputJsonValue,
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
      await appendDraftLifecycleEvent(tx, intent, "drafted", {
        actionType: input.actionType,
        voiceSessionId: input.voiceSessionId,
      })
      return intent
    })

    void logAudit(auth.orgId, "voice_action_drafted", "ai_action_intent", created.id, undefined, {
      userId: auth.userId,
      newValue: {
        actionType: input.actionType,
        voiceSessionId: input.voiceSessionId,
        revision,
      },
    })
    return serializeIntent(created, false, supersededIntentId)
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
/**
 * Черновик той же задачи, который ещё не закончен.
 *
 * «Та же задача» — то же действие и та же целевая запись. Иначе это другая
 * задача: лид после сделки не подмешивается в сделку, а заменяет квитанцию.
 * Истёкшие черновики сюда не попадают — они закрываются перед поиском.
 */
async function findAmendableDraft(
  auth: AuthResult,
  input: CreateAiVoiceActionDraftInput,
): Promise<Pick<StoredIntent, "id" | "revision" | "normalizedPayload"> | null> {
  await endOwnedSessionDraftIfOver(auth, input.voiceSessionId, new Date())
  const open = await prisma.aiActionIntent.findFirst({
    where: {
      organizationId: auth.orgId,
      userId: auth.userId,
      voiceSessionId: input.voiceSessionId,
      parentIntentId: null,
      state: "awaiting_confirmation",
      actionType: input.actionType,
    },
    select: { id: true, revision: true, normalizedPayload: true, targetEntityId: true },
  })
  if (!open) return null
  if ((open.targetEntityId ?? null) !== (input.targetEntityId ?? null)) return null
  return open
}

/**
 * Дополнить черновик, который пользователь сейчас правит голосом.
 *
 * Новые поля ложатся поверх собранных, остальные остаются как были — и это
 * ровно то, что человек имеет в виду, говоря «добавь цену» или «нет, телефон
 * другой». Идентификатор черновика не меняется: на экране та же квитанция,
 * у неё растёт ревизия, и подтверждение по-прежнему привязано к тому, что
 * пользователь видит.
 */
function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

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
    getAiVoiceActionDefinition(existing.actionType).operation === "update"
    && Object.keys(parsed.data).every((field) => field === "expectedUpdatedAt")
  ) {
    throw new AiVoiceActionDraftError(
      "EMPTY_UPDATE",
      "At least one field must be changed",
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
  const preview = await labelPreviewReferences(
    auth,
    definition.renderPreview(bound.normalizedPayload, bound.previewContext),
  )
  const payloadHash = hashAiActionIntentPayload({
    actionType: existing.actionType,
    revision,
    normalizedPayload: bound.normalizedPayload,
  })
  const expiresAt = aiActionIntentExpiresAt(now, definition.ttlMs)

  const changed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const result = await tx.aiActionIntent.updateMany({
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
    if (result.count === 1) {
      await appendDraftLifecycleEvent(tx, {
        ...existing,
        revision,
        payloadHash,
      }, "draft_updated", {
        fromRevision: existing.revision,
        toRevision: revision,
      })
    }
    return result
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
  await endOwnedSessionDraftIfOver(auth, voiceSessionId, now)
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
  // Повторное нажатие на уже закрытом брошенном исполнении — не ошибка.
  if (existing.state === "failed" && existing.errorCode === EXECUTION_ABANDONED_ERROR_CODE) {
    return serializeIntent(existing, true)
  }
  // Крестик закрывает и брошенное исполнение: лиза истекла, в CRM ничего не
  // записано, а квитанция иначе висит на экране неубираемой.
  if (
    existing.state === "executing"
    && existing.executionLeaseExpiresAt
    && existing.executionLeaseExpiresAt.getTime() <= Date.now()
  ) {
    if (existing.revision !== input.expectedRevision) {
      throw new AiVoiceActionDraftError(
        "REVISION_CONFLICT",
        "The action draft was changed by another request",
        409,
        { currentRevision: existing.revision },
      )
    }
    const closed = await abandonExpiredExecution(existing, new Date())
    if (!closed) {
      throw new AiVoiceActionDraftError(
        "INTENT_NOT_CANCELLABLE",
        "The action draft can no longer be cancelled",
        409,
        { state: existing.state },
      )
    }
    const settled = await findOwnedIntent(auth, existing.id)
    void logAudit(auth.orgId, "voice_action_cancelled", "ai_action_intent", existing.id, undefined, {
      userId: auth.userId,
      newValue: {
        actionType: existing.actionType,
        revision: existing.revision,
        reason: "execution_lease_expired",
      },
    })
    return serializeIntent(settled, false)
  }
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
  const changed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const result = await tx.aiActionIntent.updateMany({
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
    if (result.count === 1) {
      await appendDraftLifecycleEvent(tx, existing, "cancelled", {
        fromState: existing.state,
        reason: "user_cancelled",
      })
    }
    return result
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
