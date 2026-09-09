import { Prisma, type Ticket } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { autoAssignTicket } from "@/lib/auto-assign"
import { fireWebhooks } from "@/lib/webhooks"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { logAudit } from "@/lib/prisma"
import { resolveTicketSla } from "@/lib/sla-resolver"
import { trackContactEvent } from "@/lib/contact-events"
import { formatTicketNotification, sendSlackNotification } from "@/lib/slack"
import { lockTicketNumberSequence, nextTicketNumber } from "@/lib/ticket-number"
import { createTicketEntitlementMilestones } from "@/lib/entitlement-process/ticket-milestones"
import {
  buildTicketRequesterSnapshot,
  getContactRequesterSnapshot,
  resolveTicketCategoryForWrite,
} from "@/lib/ticketing/category-service"

const TICKET_NUMBER_RETRY_LIMIT = 5

export interface CreateTicketInput {
  organizationId: string
  subject: string
  description?: string
  ticketNumberPrefix?: string
  priority?: "low" | "medium" | "high" | "critical"
  initialStatus?: "new" | "open"
  category?: string | null
  categoryId?: string | null
  preserveUnknownCategory?: boolean
  contactId?: string | null
  leadId?: string | null
  companyId?: string | null
  assignedTo?: string | null
  createdBy?: string | null
  tags?: string[]
  source?: string | null          // portal | email | whatsapp | web_chat | facebook | instagram | agent
  sourceMeta?: Prisma.InputJsonObject // channel-specific context (phone, sessionId, externalId)
  requesterName?: string | null
  requesterEmail?: string | null
  requesterPhone?: string | null
  requesterExternalId?: string | null
  requesterMeta?: Prisma.InputJsonObject | null
}

function isTicketNumberConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false
  }
  const target = error.meta?.target
  if (Array.isArray(target)) {
    return target.includes("organizationId") && target.includes("ticketNumber")
  }
  return String(target || "").includes("ticketNumber")
}

async function emitTicketCreatedSideEffects(ticket: Ticket): Promise<void> {
  logAudit(ticket.organizationId, "create", "ticket", ticket.id, ticket.subject)
  executeWorkflows(ticket.organizationId, "ticket", "created", ticket).catch(() => {})
  fireWebhooks(ticket.organizationId, "ticket.created", {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    priority: ticket.priority,
  }).catch(() => {})

  if (ticket.assignedTo) {
    createNotification({
      organizationId: ticket.organizationId,
      userId: ticket.assignedTo,
      type: ticket.priority === "critical" ? "error" : ticket.priority === "high" ? "warning" : "info",
      title: `Новый тикет ${ticket.ticketNumber}`,
      message: `${ticket.subject}${ticket.priority === "critical" ? " (КРИТИЧЕСКИЙ)" : ""}`,
      entityType: "ticket",
      entityId: ticket.id,
      push: true,
      kind: "ticket.created",
    }).catch(() => {})
  }

  if (ticket.contactId) {
    trackContactEvent(ticket.organizationId, ticket.contactId, "ticket_created", { ticketId: ticket.id }).catch(() => {})
  }

  prisma.channelConfig.findMany({
    where: { organizationId: ticket.organizationId, channelType: "slack", isActive: true },
  }).then((configs: Array<{ webhookUrl: string | null }>) => {
    const message = formatTicketNotification({
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      priority: ticket.priority,
      status: ticket.status,
    })
    for (const config of configs) {
      if (config.webhookUrl) sendSlackNotification(config.webhookUrl, message).catch(() => {})
    }
  }).catch(() => {})
}

/**
 * Create a ticket with the full downstream flow:
 *   - Transaction-scoped sequential TK-0001 numbering
 *   - Company → priority-based SLA resolution
 *   - Auto-assign (skill-based routing) when no assignee
 *   - Audit log, workflow engine, notifications, webhooks, contact event, Slack
 *
 * Used by the standard /api/v1/tickets POST endpoint AND by any system integration
 * that opens a ticket (web-chat escalation, social mention conversion, etc.).
 *
 * Pass `input.fireHooks = false` to create the ticket silently (no audit/webhook/
 * workflow/notification). Caller is then responsible for calling `fireTicketHooks`
 * once the ticket is "committed" (e.g., after an atomic claim succeeds). This is
 * how web-chat escalation avoids firing hooks for a ticket that was created-then-
 * deleted because another escalation call won the race.
 */
export async function fireTicketHooks(ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
  if (!ticket) return
  await emitTicketCreatedSideEffects(ticket)
}

export async function createTicketWithAssignment(
  input: CreateTicketInput & { fireHooks?: boolean },
): Promise<Ticket> {
  const orgId = input.organizationId

  const resolvedCategory = await resolveTicketCategoryForWrite(orgId, {
    categoryId: input.categoryId,
    category: input.category,
    preserveUnknown: input.preserveUnknownCategory,
  })
  const priority = input.priority || resolvedCategory.defaultPriority || "medium"
  const category = resolvedCategory.category
  let resolvedCompanyId = input.companyId || null
  if (!resolvedCompanyId && input.contactId) {
    const contactCompany = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: orgId },
      select: { companyId: true },
    })
    resolvedCompanyId = contactCompany?.companyId || null
  }

  // 1. SLA resolution (company → priority-based) — shared resolver, single
  //    source of truth across every ticket-creation path.
  const sla = await resolveTicketSla(orgId, { companyId: resolvedCompanyId, priority })

  const requesterSnapshot = input.contactId
    ? await getContactRequesterSnapshot(orgId, input.contactId)
    : buildTicketRequesterSnapshot({
        name: input.requesterName,
        email: input.requesterEmail,
        phone: input.requesterPhone,
        externalId: input.requesterExternalId,
        meta: input.requesterMeta,
      })
  let ticket: Ticket | null = null
  for (let attempt = 1; attempt <= TICKET_NUMBER_RETRY_LIMIT; attempt += 1) {
    try {
      ticket = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await lockTicketNumberSequence(orgId, tx)
        const ticketNumber = await nextTicketNumber(orgId, tx, input.ticketNumberPrefix || "TK")
        const created = await tx.ticket.create({
          data: {
            organizationId: orgId,
            ticketNumber,
            subject: input.subject,
            description: input.description,
            priority,
            category,
            categoryId: resolvedCategory.categoryId,
            status: input.initialStatus || "new",
            contactId: input.contactId || null,
            leadId: input.leadId || null,
            companyId: resolvedCompanyId,
            assignedTo: input.assignedTo || null,
            createdBy: input.createdBy || null,
            tags: input.tags || [],
            source: input.source || null,
            sourceMeta: input.sourceMeta as Prisma.InputJsonValue | undefined,
            ...requesterSnapshot,
            ...sla,
          },
        })
        await createTicketEntitlementMilestones(tx, {
          organizationId: orgId,
          ticketId: created.id,
          companyId: created.companyId,
          ticketCreatedAt: created.createdAt,
          priority: created.priority,
        })
        return created
      })
      break
    } catch (error) {
      if (attempt < TICKET_NUMBER_RETRY_LIMIT && isTicketNumberConflict(error)) {
        continue
      }
      throw error
    }
  }

  if (!ticket) {
    throw new Error("Failed to create ticket")
  }

  let finalTicket: Ticket = ticket
  let finalAssignee = finalTicket.assignedTo

  // 2. Auto-assign if none
  if (!input.assignedTo) {
    try {
      const result = await autoAssignTicket(ticket.id, orgId, category)
      if (result.assigned && result.agentId) {
        finalAssignee = result.agentId
        const updated = await prisma.ticket.findFirst({ where: { id: finalTicket.id, organizationId: orgId } })
        if (updated) finalTicket = updated
      }
    } catch (e) {
      console.error("[ticket-factory] auto-assign failed:", e)
    }
  }

  // 3. Side effects (non-blocking). Skip when caller wants atomic claim first.
  const ticketWithAssignee: Ticket = { ...finalTicket, assignedTo: finalAssignee }
  if (input.fireHooks !== false) {
    await emitTicketCreatedSideEffects(ticketWithAssignee)
  }

  return ticketWithAssignee
}
