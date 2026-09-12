import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { createNotification } from "@/lib/notifications"
import { markTicketMilestonesMet } from "@/lib/entitlement-process/ticket-milestones"

type JsonObject = Record<string, unknown>

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

const commentSchema = z.object({
  comment: z.string().min(1).max(5000),
  isInternal: z.boolean().default(false),
  attachmentIds: z.array(z.string().min(1)).max(10).default([]),
  clientRequestId: z.string().uuid().optional(),
}).refine((value) => new Set(value.attachmentIds).size === value.attachmentIds.length, {
  message: "Duplicate attachment IDs are not allowed",
  path: ["attachmentIds"],
})

class AttachmentConflictError extends Error {}

export const POST = withRlsAuth("tickets", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = auth
  const { id: ticketId } = await params

  const body = await req.json()
  const parsed = commentSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Verify ticket exists and belongs to org
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, organizationId: orgId },
  })
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
  if (ticket.status === "closed") {
    return NextResponse.json({ error: "ticket_closed", errorKey: "ticketClosed" }, { status: 409 })
  }

  const createComment = async () => {
    // Keep the legacy API contract for integrations that do not yet send an
    // idempotency key or attachments. The first-party composer always uses the
    // transaction-safe branch below.
    if (!parsed.data.clientRequestId && parsed.data.attachmentIds.length === 0) {
      return {
        comment: await prisma.ticketComment.create({
          data: {
            ticketId,
            userId,
            comment: parsed.data.comment,
            isInternal: parsed.data.isInternal,
          },
        }),
        replayed: false,
      }
    }

    return prisma.$transaction(async (tx) => {
      if (parsed.data.clientRequestId) {
        const existing = await tx.ticketComment.findUnique({
          where: {
            ticketId_clientRequestId: {
              ticketId,
              clientRequestId: parsed.data.clientRequestId,
            },
          },
          include: { attachments: true },
        })
        if (existing) {
          if (
            existing.userId !== userId
            || existing.comment !== parsed.data.comment
            || existing.isInternal !== parsed.data.isInternal
          ) {
            throw new AttachmentConflictError("Request key was already used for different content")
          }
          return { comment: existing, replayed: true }
        }
      }

      if (parsed.data.attachmentIds.length > 0) {
        const available = await tx.ticketAttachment.count({
          where: {
            id: { in: parsed.data.attachmentIds },
            organizationId: orgId,
            ticketId,
            commentId: null,
            uploadedBy: userId,
          },
        })
        if (available !== parsed.data.attachmentIds.length) {
          throw new AttachmentConflictError("One or more attachments are unavailable")
        }
      }

      const created = await tx.ticketComment.create({
        data: {
          ticketId,
          userId,
          comment: parsed.data.comment,
          isInternal: parsed.data.isInternal,
          clientRequestId: parsed.data.clientRequestId,
        },
      })

      if (parsed.data.attachmentIds.length > 0) {
        const attached = await tx.ticketAttachment.updateMany({
          where: {
            id: { in: parsed.data.attachmentIds },
            organizationId: orgId,
            ticketId,
            commentId: null,
            uploadedBy: userId,
          },
          data: { commentId: created.id },
        })
        if (attached.count !== parsed.data.attachmentIds.length) {
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
    })
  }

  let result: Awaited<ReturnType<typeof createComment>>
  try {
    result = await createComment()
  } catch (error) {
    if (error instanceof AttachmentConflictError) {
      return NextResponse.json({ error: error.message, errorKey: "attachmentConflict" }, { status: 409 })
    }
    if (parsed.data.clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.ticketComment.findUnique({
        where: { ticketId_clientRequestId: { ticketId, clientRequestId: parsed.data.clientRequestId } },
        include: { attachments: true },
      })
      if (
        existing
        && existing.userId === userId
        && existing.comment === parsed.data.comment
        && existing.isInternal === parsed.data.isInternal
      ) {
        result = { comment: existing, replayed: true }
      } else {
        return NextResponse.json({ error: "Duplicate request conflict", errorKey: "duplicateRequestConflict" }, { status: 409 })
      }
    } else {
      console.error("[ticket-comments POST]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }

  const { comment, replayed } = result

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

  // Update firstResponseAt if this is the first staff response
  if (!replayed && !ticket.firstResponseAt && !parsed.data.isInternal) {
    const firstResponseAt = new Date()
    await prisma.ticket.updateMany({
      where: { id: ticketId, organizationId: orgId },
      data: { firstResponseAt },
    })
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

  // Send reply to WhatsApp if ticket originated from WhatsApp and comment is not internal
  if (!replayed && !parsed.data.isInternal && ticket.tags && (ticket.tags as string[]).includes("whatsapp")) {
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
          message: parsed.data.comment,
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

  return NextResponse.json({ success: true, data: comment, replayed }, { status: replayed ? 200 : 201 })
})
