import { NextResponse } from "next/server"
import { z } from "zod"
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
})

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

  const comment = await prisma.ticketComment.create({
    data: {
      ticketId,
      userId,
      comment: parsed.data.comment,
      isInternal: parsed.data.isInternal,
    },
  })

  // Notify ticket assignee about new comment (if commenter is not the assignee)
  if (ticket.assignedTo && ticket.assignedTo !== userId) {
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
  if (!ticket.firstResponseAt && !parsed.data.isInternal) {
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
  if (!parsed.data.isInternal && ticket.tags && (ticket.tags as string[]).includes("whatsapp")) {
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

  return NextResponse.json({ success: true, data: comment }, { status: 201 })
})
