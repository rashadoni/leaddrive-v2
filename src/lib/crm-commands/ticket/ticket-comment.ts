import { createHash } from "node:crypto"
import { Prisma, type Ticket } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { createNotification } from "@/lib/notifications"
import { markTicketMilestonesMet } from "@/lib/entitlement-process/ticket-milestones"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { CrmCommandError, notFoundError, validationError } from "../errors"

/**
 * Комментарий в тикете — одна команда для экрана
 * (`POST /api/v1/tickets/[id]/comments`) и для голоса (этап 4, владелец
 * 2026-11-09): внутренняя заметка («запиши в тикет: ждём склад») и ответ
 * клиенту («ответь клиенту по тикету: …»).
 *
 * Ответ клиенту, как и на экране, отмечает первый ответ (SLA) и, если тикет
 * пришёл из WhatsApp, уходит клиенту в WhatsApp. Внутри чужой транзакции
 * (голос) запись идёт в ней, а уведомление, SLA-отметка и WhatsApp — после
 * коммита. Повтор голосового подтверждения не пишет второй комментарий: ключ
 * запроса выводится из черновика.
 */

type JsonObject = Record<string, unknown>

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

export const ticketCommentCommandSchema = z.object({
  comment: z.string().min(1).max(5000),
  isInternal: z.boolean().default(false),
  attachmentIds: z.array(z.string().min(1)).max(10).default([]),
  clientRequestId: z.string().uuid().optional(),
}).refine((value) => new Set(value.attachmentIds).size === value.attachmentIds.length, {
  message: "Duplicate attachment IDs are not allowed",
  path: ["attachmentIds"],
})

class AttachmentConflictError extends Error {}

function conflict(message: string, errorKey: string): CrmCommandError {
  return new CrmCommandError("CONFLICT", message, 409, { errorKey })
}

/** UUID из идентификатора черновика: один черновик — один комментарий. */
function voiceRequestId(intentId: string): string {
  const hex = createHash("sha256").update(`voice-ticket-comment:${intentId}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

type TicketCommentWithAttachments = Prisma.TicketCommentGetPayload<{ include: { attachments: true } }>
type StoredComment = TicketCommentWithAttachments | Prisma.TicketCommentGetPayload<object>

export interface AddTicketCommentCommandResult {
  ticket: Ticket
  comment: StoredComment
  replayed: boolean
}

export async function addTicketCommentCommand(
  actor: CrmCommandActorContext,
  ticketId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<AddTicketCommentCommandResult> {
  const parsed = ticketCommentCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid comment")
  const orgId = actor.organizationId
  const userId = actor.userId
  const input = {
    ...parsed.data,
    ...(actor.source === "voice" && actor.actionIntentId && !parsed.data.clientRequestId
      ? { clientRequestId: voiceRequestId(actor.actionIntentId) }
      : {}),
  }
  const db = execution?.transaction ?? prisma

  // Verify ticket exists and belongs to org
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, organizationId: orgId },
  })
  if (!ticket) throw notFoundError("Ticket not found")
  if (ticket.status === "closed") throw conflict("ticket_closed", "ticketClosed")

  const createIn = async (tx: Prisma.TransactionClient): Promise<{ comment: StoredComment; replayed: boolean }> => {
    if (input.clientRequestId) {
      const existing = await tx.ticketComment.findUnique({
        where: { ticketId_clientRequestId: { ticketId, clientRequestId: input.clientRequestId } },
        include: { attachments: true },
      })
      if (existing) {
        if (
          existing.userId !== userId
          || existing.comment !== input.comment
          || existing.isInternal !== input.isInternal
        ) {
          throw new AttachmentConflictError("Request key was already used for different content")
        }
        return { comment: existing, replayed: true }
      }
    }

    if (input.attachmentIds.length > 0) {
      const available = await tx.ticketAttachment.count({
        where: {
          id: { in: input.attachmentIds },
          organizationId: orgId,
          ticketId,
          commentId: null,
          uploadedBy: userId,
        },
      })
      if (available !== input.attachmentIds.length) {
        throw new AttachmentConflictError("One or more attachments are unavailable")
      }
    }

    const created = await tx.ticketComment.create({
      data: {
        ticketId,
        userId,
        comment: input.comment,
        isInternal: input.isInternal,
        clientRequestId: input.clientRequestId,
      },
    })

    if (input.attachmentIds.length > 0) {
      const attached = await tx.ticketAttachment.updateMany({
        where: {
          id: { in: input.attachmentIds },
          organizationId: orgId,
          ticketId,
          commentId: null,
          uploadedBy: userId,
        },
        data: { commentId: created.id },
      })
      if (attached.count !== input.attachmentIds.length) {
        throw new AttachmentConflictError("One or more attachments changed before send")
      }
    }

    return {
      comment: await tx.ticketComment.findUniqueOrThrow({
        where: { id: created.id },
        include: { attachments: true },
      }),
      replayed: false,
    }
  }

  const createComment = async (): Promise<{ comment: StoredComment; replayed: boolean }> => {
    if (execution?.transaction) return createIn(execution.transaction)
    // Keep the legacy API contract for integrations that do not yet send an
    // idempotency key or attachments. The first-party composer always uses the
    // transaction-safe branch below.
    if (!input.clientRequestId && input.attachmentIds.length === 0) {
      return {
        comment: await prisma.ticketComment.create({
          data: { ticketId, userId, comment: input.comment, isInternal: input.isInternal },
        }),
        replayed: false,
      }
    }
    return prisma.$transaction((tx: Prisma.TransactionClient) => createIn(tx))
  }

  let result: { comment: StoredComment; replayed: boolean }
  try {
    result = await createComment()
  } catch (error) {
    if (error instanceof AttachmentConflictError) throw conflict(error.message, "attachmentConflict")
    if (
      !execution?.transaction
      && input.clientRequestId
      && error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      const existing = await prisma.ticketComment.findUnique({
        where: { ticketId_clientRequestId: { ticketId, clientRequestId: input.clientRequestId } },
        include: { attachments: true },
      })
      if (
        existing
        && existing.userId === userId
        && existing.comment === input.comment
        && existing.isInternal === input.isInternal
      ) {
        result = { comment: existing, replayed: true }
      } else {
        throw conflict("Duplicate request conflict", "duplicateRequestConflict")
      }
    } else {
      throw error
    }
  }

  const { comment, replayed } = result
  const firstResponse = !replayed && !ticket.firstResponseAt && !input.isInternal
  const firstResponseAt = new Date()
  if (firstResponse) {
    await db.ticket.updateMany({
      where: { id: ticketId, organizationId: orgId },
      data: { firstResponseAt },
    })
  }

  const notifyAssignee = () => {
    // Notify ticket assignee about new comment (if commenter is not the assignee)
    if (!replayed && ticket.assignedTo && ticket.assignedTo !== userId) {
      createNotification({
        organizationId: orgId,
        userId: ticket.assignedTo,
        type: "info",
        title: `Tiketə şərh əlavə edildi: ${ticket.subject}`,
        message: `${ticket.ticketNumber} — yeni şərh`,
        entityType: "ticket",
        entityId: ticketId,
        push: true,
        kind: "ticket.comment",
      }).catch(() => {})
    }
  }
  const markFirstResponse = async () => {
    if (!firstResponse) return
    try {
      await markTicketMilestonesMet(prisma, {
        organizationId: orgId,
        ticketId,
        types: ["first_response"],
        completedAt: firstResponseAt,
        eventName: "first_response_comment",
        actorUserId: userId,
      })
    } catch (error) {
      console.error("[ticket-milestones] first response update failed:", error)
    }
  }
  const replyOnWhatsApp = async () => {
    if (!replayed && !input.isInternal && ticket.tags && (ticket.tags as string[]).includes("whatsapp")) {
      await sendTicketReplyToWhatsApp(orgId, ticket, input.comment)
    }
  }

  if (execution?.transaction) {
    dispatchOrDeferCommandEffects(execution, async () => {
      notifyAssignee()
      await markFirstResponse()
      await replyOnWhatsApp()
    })
  } else {
    notifyAssignee()
    await markFirstResponse()
    await replyOnWhatsApp()
  }

  return { ticket, comment, replayed }
}

/** Send reply to WhatsApp if ticket originated from WhatsApp and comment is not internal. */
async function sendTicketReplyToWhatsApp(orgId: string, ticket: Ticket, text: string): Promise<void> {
  try {
    // Extract phone number from ticket description (format: "+994512060838")
    const phoneMatch = ticket.description?.match(/\+(\d{10,15})/)
    let waPhone = phoneMatch?.[1]

    // If no phone in description, try to get from contact
    if (!waPhone && ticket.contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: ticket.contactId, organizationId: orgId },
        select: { phone: true },
      })
      if (contact?.phone) {
        waPhone = contact.phone.replace(/[\s\-\(\)\+]/g, "")
      }
    }

    // Also try to find from recent WhatsApp inbound messages for this contact
    if (!waPhone && ticket.contactId) {
      const recentWaMsg = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          contactId: ticket.contactId,
          channelType: "whatsapp",
          direction: "inbound",
        },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      })
      const meta = asJsonObject(recentWaMsg?.metadata)
      if (typeof meta.waPhone === "string") {
        waPhone = meta.waPhone
      }
    }

    if (waPhone) {
      const result = await sendWhatsAppMessage({
        to: waPhone,
        message: text,
        organizationId: orgId,
        contactId: ticket.contactId || undefined,
      })
      console.log(`[Ticket WA] Reply to ${waPhone} for ticket ${ticket.ticketNumber}: ${result.success ? "OK" : result.error}`)
    } else {
      console.log(`[Ticket WA] No phone found for ticket ${ticket.ticketNumber}`)
    }
  } catch (err) {
    console.error(`[Ticket WA] Error sending reply:`, err)
  }
}
