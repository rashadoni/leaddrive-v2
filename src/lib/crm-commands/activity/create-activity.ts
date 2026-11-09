import type { Activity, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { trackContactEvent } from "@/lib/contact-events"
import { autoExitSequenceEnrollments } from "@/lib/sequence-auto-exit"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { notFoundError, validationError } from "../errors"
import { createActivityCommandSchema } from "../schemas/activity"

/**
 * Запись в ленте карточки — заметка, звонок, письмо, встреча — одной
 * командой для экрана (`POST /api/v1/activities`) и для голоса («запиши
 * звонок с Анаром: договорились о встрече», этап 3, владелец 2026-11-09).
 *
 * Карточка, к которой пишется запись, обязана быть этой организации. Экран
 * раньше этого не проверял: внешний ключ не видит политик RLS, и запись
 * могла сослаться на чужой контакт или компанию.
 */

/** Виды карточек, чью принадлежность проверяет команда. Прочие ссылки — как есть. */
const CHECKED_RELATED_TYPES = new Set(["contact", "company", "deal", "lead"])

async function requireRecord(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  type: string,
  id: string,
): Promise<void> {
  const where = { id, organizationId }
  const select = { id: true } as const
  const found = type === "contact"
    ? await db.contact.findFirst({ where, select })
    : type === "company"
      ? await db.company.findFirst({ where, select })
      : type === "deal"
        ? await db.deal.findFirst({ where, select })
        : await db.lead.findFirst({ where, select })
  if (!found) throw notFoundError("Record not found")
}

export interface CreateActivityCommandResult {
  entity: Activity
}

export async function createActivityCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<CreateActivityCommandResult> {
  const parsed = createActivityCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid activity")
  const { scheduledAt: rawScheduledAt, ...input } = parsed.data
  const orgId = actor.organizationId
  const db = execution?.transaction ?? prisma

  let scheduledAt: Date | undefined
  if (rawScheduledAt) {
    scheduledAt = new Date(rawScheduledAt)
    if (Number.isNaN(scheduledAt.getTime())) throw validationError("Invalid scheduledAt")
  }

  if (input.contactId) await requireRecord(db, orgId, "contact", input.contactId)
  if (input.companyId) await requireRecord(db, orgId, "company", input.companyId)
  if (input.relatedType && input.relatedId && CHECKED_RELATED_TYPES.has(input.relatedType)) {
    await requireRecord(db, orgId, input.relatedType, input.relatedId)
  }

  const activity = await db.activity.create({
    data: {
      organizationId: orgId,
      createdBy: actor.userId,
      ...input,
      ...(scheduledAt ? { scheduledAt } : {}),
    },
  })

  if (activity.contactId) {
    const contactId = activity.contactId
    const eventType = activity.type === "meeting" ? "meeting_scheduled"
      : activity.type === "call" ? "call_logged"
      : "note_added"
    dispatchOrDeferCommandEffects(execution, () => {
      trackContactEvent(orgId, contactId, eventType, { activityId: activity.id, type: activity.type }).catch(() => {})
    })
  }

  // Cadence auto-exit: a logged meeting means the outreach worked — stop the
  // person's active sequence enrollments (never throws). The screen waits for
  // it, as before; inside a wider transaction it runs after the commit.
  if (activity.type === "meeting" && (activity.contactId || activity.relatedType === "lead")) {
    const exit = () => autoExitSequenceEnrollments({
      organizationId: orgId,
      trigger: "meeting_booked",
      contactId: activity.contactId,
      leadId: activity.relatedType === "lead" ? activity.relatedId : null,
    })
    if (execution?.transaction) dispatchOrDeferCommandEffects(execution, async () => { await exit() })
    else await exit()
  }

  return { entity: activity }
}
