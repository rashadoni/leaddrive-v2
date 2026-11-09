import type { Ticket } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getFieldPermissions, filterWritableFields } from "@/lib/field-filter"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { LEGACY_TICKET_CATEGORY_SLUGS } from "@/lib/ticketing/categories"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { CrmCommandError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"

/**
 * Новый тикет — одна команда для экрана (`POST /api/v1/tickets`) и для голоса
 * («заведи тикет: у Azmart не работает касса», этап 4, владелец 2026-11-09).
 *
 * Номер, SLA, вехи договора поддержки, авто-назначение, уведомления — всё в
 * общей фабрике тикетов. Клиенту создание тикета ничего не отправляет.
 */

export const createTicketCommandSchema = z.object({
  subject: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z.enum(LEGACY_TICKET_CATEGORY_SLUGS).optional(),
  categoryId: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  assignedTo: z.string().optional(),
})

/** Что голос может сказать о новом тикете; люди и клиенты — по имени, ссылки ставит сервер. */
export const VOICE_CREATE_TICKET_FIELDS = ["subject", "description", "priority", "contactId", "companyId", "assignedTo"] as const

type CreateTicketWritableData = {
  subject: string
  description?: string
  priority?: "low" | "medium" | "high" | "critical"
  category?: (typeof LEGACY_TICKET_CATEGORY_SLUGS)[number]
  categoryId?: string | null
  contactId?: string | null
  companyId?: string | null
  assignedTo?: string | null
}

export interface CreateTicketCommandResult {
  entity: Ticket
}

export async function createTicketCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<CreateTicketCommandResult> {
  const parsed = createTicketCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid ticket")
  const orgId = actor.organizationId
  const role = actor.role
  const db = execution?.transaction ?? prisma

  const requested = {
    subject: parsed.data.subject,
    description: parsed.data.description,
    priority: parsed.data.priority,
    category: parsed.data.category,
    categoryId: parsed.data.categoryId,
    contactId: parsed.data.contactId,
    companyId: parsed.data.companyId,
    assignedTo: parsed.data.assignedTo,
  }
  const fieldPerms = await getFieldPermissions(orgId, role, "ticket")
  let writableData: CreateTicketWritableData
  if (actor.source === "rest") {
    writableData = filterWritableFields(requested, fieldPerms, role) as CreateTicketWritableData
  } else {
    const allowed = new Set<string>(VOICE_CREATE_TICKET_FIELDS)
    const given = Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== undefined))
    const forbidden = Object.keys(given).filter((field) => !allowed.has(field))
    if (forbidden.length > 0) {
      throw new CrmCommandError("FORBIDDEN_FIELD", `Fields are not available to voice: ${forbidden.join(", ")}`, 403, { fields: forbidden })
    }
    writableData = requireWritableFields(given, fieldPerms, role) as CreateTicketWritableData
    if (writableData.assignedTo) {
      const assignee = await db.user.findFirst({
        where: { id: writableData.assignedTo, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!assignee) throw validationError("Assignee must be an active member of this organization")
    }
  }

  // Клиент тикета — только своей организации: внешний ключ политик RLS не видит.
  if (writableData.contactId) {
    const contact = await db.contact.findFirst({ where: { id: writableData.contactId, organizationId: orgId }, select: { id: true } })
    if (!contact) throw validationError("Invalid contactId")
  }
  if (writableData.companyId) {
    const company = await db.company.findFirst({ where: { id: writableData.companyId, organizationId: orgId }, select: { id: true } })
    if (!company) throw validationError("Invalid companyId")
  }

  const ticket = await createTicketWithAssignment(
    {
      organizationId: orgId,
      createdBy: actor.userId,
      source: "agent",
      ...writableData,
    },
    execution?.transaction
      ? {
          transaction: execution.transaction,
          afterCommit: (effect) => dispatchOrDeferCommandEffects(execution, effect),
        }
      : undefined,
  )
  return { entity: ticket }
}
