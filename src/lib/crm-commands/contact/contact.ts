import type { Contact } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { filterWritableFields, requireFieldPermissions } from "@/lib/field-filter"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { checkContactLimit } from "@/lib/plan-limits"
import { trackContactEvent } from "@/lib/contact-events"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { applyAutoEarn } from "@/lib/loyalty"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import {
  CrmCommandError,
  forbiddenError,
  notFoundError,
  staleWriteError,
  validationError,
} from "../errors"
import { requireWritableFields } from "../field-permissions"
import {
  createContactCommandSchema,
  updateContactCommandSchema,
  VOICE_CONTACT_FIELDS,
  type CreateContactCommandInput,
  type UpdateContactCommandInput,
} from "../schemas/contact"

/**
 * Контакт — одной командой для экрана (`/api/v1/contacts`,
 * `/api/v1/contacts/[id]`) и для голоса («создай контакт Анар Мамедов,
 * телефон …», «поменяй Анару должность», этап 3, владелец 2026-11-09).
 *
 * Всё, что делал экран после записи (журнал, автоматизации, профиль клиента,
 * бонус лояльности за регистрацию, уведомление, вебхуки, событие контакта),
 * делает команда — после коммита, если её позвали внутри чужой транзакции.
 *
 * Два отличия источников, и оба намеренные:
 *  - экран, как и раньше, молча отбрасывает поля, которые роли писать нельзя;
 *    голос получает отказ — квитанция и запись обязаны совпадать;
 *  - голос пишет только сказанные вслух поля (VOICE_CONTACT_FIELDS) и
 *    правку — только с версией, которую видел подтверждающий.
 */

const VOICE_FIELDS: ReadonlySet<string> = new Set(VOICE_CONTACT_FIELDS)

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid contact"
}

function enforceVoiceFields(input: Record<string, unknown>): void {
  const forbidden = Object.keys(input).filter((field) => field !== "expectedUpdatedAt" && !VOICE_FIELDS.has(field))
  if (forbidden.length > 0) {
    throw new CrmCommandError(
      "FORBIDDEN_FIELD",
      `Fields are not available to voice: ${forbidden.join(", ")}`,
      403,
      { fields: forbidden },
    )
  }
}

async function writableContactFields<T extends Record<string, unknown>>(
  actor: CrmCommandActorContext,
  input: T,
): Promise<T> {
  const permissions = await requireFieldPermissions(actor.organizationId, actor.role, "contact")
  return actor.source === "rest"
    ? filterWritableFields(input, permissions, actor.role) as T
    : requireWritableFields(input, permissions, actor.role)
}

/**
 * Компания контакта — только своей организации. Раньше экран писал любой id
 * как есть: внешний ключ не видит политик RLS, и контакт мог сослаться на
 * чужую компанию. Пустая строка — «без компании».
 */
async function checkCompany(
  actor: CrmCommandActorContext,
  db: Pick<typeof prisma, "company">,
  companyId: unknown,
): Promise<void> {
  if (typeof companyId !== "string" || !companyId) return
  const company = await db.company.findFirst({
    where: { id: companyId, organizationId: actor.organizationId },
    select: { id: true },
  })
  if (!company) throw validationError("Invalid companyId")
}

export interface CreateContactCommandResult {
  entity: Contact
}

export async function createContactCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<CreateContactCommandResult> {
  const parsed = createContactCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))
  if (actor.source === "voice") enforceVoiceFields(parsed.data)

  const orgId = actor.organizationId
  const db = execution?.transaction ?? prisma

  const limitCheck = await checkContactLimit(orgId)
  if (!limitCheck.allowed) throw forbiddenError(limitCheck.message ?? "Contact limit reached")

  const requested: CreateContactCommandInput = { ...parsed.data }
  if (requested.companyId === "") delete requested.companyId
  const data = await writableContactFields(actor, requested as Record<string, unknown>) as CreateContactCommandInput
  await checkCompany(actor, db, data.companyId)

  const contact = await db.contact.create({ data: { organizationId: orgId, ...data } })

  dispatchOrDeferCommandEffects(execution, () => {
    logAudit(orgId, "create", "contact", contact.id, contact.fullName, {
      ...(actor.userId ? { userId: actor.userId } : {}),
    })
    executeWorkflows(orgId, "contact", "created", contact).catch(() => {})
    // CDP: build/refresh this contact's unified profile immediately (don't wait
    // for the hourly cron). A CDP failure must not break create.
    refreshProfileForSource(prisma, orgId, "contact", contact.id).catch((e) =>
      console.error("[cdp-hook] contact-create profile refresh failed", e),
    )
    // Loyalty signup bonus. No-ops unless the tenant turned auto-earn on AND
    // has an active "signup" earning rule. Idempotent on referenceId=contactId.
    applyAutoEarn(prisma, {
      orgId,
      contactId: contact.id,
      trigger: "signup",
      referenceId: contact.id,
      reason: `Signup bonus — ${contact.fullName || contact.email || contact.id}`,
      requireAutoEarnEnabled: true,
    }).catch((e) => console.error("[loyalty auto-earn] signup", e))
    createNotification({
      organizationId: orgId,
      type: "info",
      title: "Новый контакт",
      message: `Добавлен контакт «${contact.fullName}»`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {})
    fireWebhooks(orgId, "contact.created", { id: contact.id, fullName: contact.fullName, email: contact.email }).catch(() => {})
    if (contact.source === "portal" || contact.source === "form" || contact.source === "website") {
      trackContactEvent(orgId, contact.id, "form_submitted", { source: contact.source }).catch(() => {})
    }
  })

  return { entity: contact }
}

export interface UpdateContactCommandResult {
  entity: Contact
}

export async function updateContactCommand(
  actor: CrmCommandActorContext,
  contactId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<UpdateContactCommandResult> {
  const parsed = updateContactCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))
  if (actor.source === "voice") {
    enforceVoiceFields(parsed.data)
    if (!parsed.data.expectedUpdatedAt) throw validationError("expectedUpdatedAt is required for voice updates")
  }

  const orgId = actor.organizationId
  const db = execution?.transaction ?? prisma
  const { expectedUpdatedAt, ...requested } = parsed.data
  const changes: Omit<UpdateContactCommandInput, "expectedUpdatedAt"> = { ...requested }
  if (changes.companyId === "") changes.companyId = null
  const data = await writableContactFields(actor, changes as Record<string, unknown>) as typeof changes
  if (actor.source === "voice" && Object.keys(data).length === 0) throw validationError("No writable fields")
  await checkCompany(actor, db, data.companyId)

  const expectedDate = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null
  const result = await db.contact.updateMany({
    where: {
      id: contactId,
      organizationId: orgId,
      ...(expectedDate ? { updatedAt: expectedDate } : {}),
    },
    data,
  })
  if (result.count === 0) {
    if (expectedDate) {
      const exists = await db.contact.findFirst({ where: { id: contactId, organizationId: orgId }, select: { id: true } })
      if (exists) throw staleWriteError()
    }
    throw notFoundError("Not found")
  }
  const updated = await db.contact.findFirst({ where: { id: contactId, organizationId: orgId } })
  if (!updated) throw notFoundError("Not found")

  dispatchOrDeferCommandEffects(execution, () => {
    logAudit(orgId, "update", "contact", contactId, updated.fullName || "", {
      newValue: requested,
      ...(actor.userId ? { userId: actor.userId } : {}),
    })
    executeWorkflows(orgId, "contact", "updated", updated).catch(() => {})
    fireWebhooks(orgId, "contact.updated", { id: updated.id, fullName: updated.fullName, email: updated.email }).catch(() => {})
  })

  return { entity: updated }
}
