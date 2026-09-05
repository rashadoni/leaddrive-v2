import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getPortalUser } from "@/lib/portal-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { runWithTenant } from "@/lib/rls-context"
import {
  storeTicketAttachment,
  TicketAttachmentInputError,
} from "@/lib/ticketing/ticket-attachment-storage"

type RouteContext = { params: Promise<{ id: string }> }

async function ownedTicket(organizationId: string, contactId: string, ticketId: string) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, organizationId, contactId },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: ticketId } = await context.params

  return runWithTenant(user.organizationId, async () => {
    if (!(await ownedTicket(user.organizationId, user.contactId, ticketId))) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const files = await prisma.ticketAttachment.findMany({
      where: {
        organizationId: user.organizationId,
        ticketId,
        OR: [
          { comment: { is: { isInternal: false } } },
          { commentId: null, uploadedBy: user.contactId },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        commentId: true,
        originalName: true,
        fileSize: true,
        mimeType: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ success: true, data: files })
  })
}

export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: ticketId } = await context.params

  if (!checkRateLimit(`portal-ticket-upload:${user.organizationId}:${user.contactId}`, { maxRequests: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
  }

  return runWithTenant(user.organizationId, async () => {
    if (!(await ownedTicket(user.organizationId, user.contactId, ticketId))) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    try {
      const formData = await req.formData()
      const file = formData.get("file")
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 })
      }
      const record = await storeTicketAttachment({
        organizationId: user.organizationId,
        ticketId,
        uploadedBy: user.contactId,
        file,
      })
      return NextResponse.json({ success: true, data: record }, { status: 201 })
    } catch (error) {
      if (error instanceof TicketAttachmentInputError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      console.error("[portal-ticket-files POST]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}

