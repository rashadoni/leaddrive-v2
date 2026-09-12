import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRlsAuth } from "@/lib/with-rls"
import {
  storeTicketAttachment,
  TicketAttachmentInputError,
} from "@/lib/ticketing/ticket-attachment-storage"

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("tickets", "read", async (_req, auth, context: RouteContext) => {
  const { id } = await context.params
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    const files = await prisma.ticketAttachment.findMany({
      where: { ticketId: id, organizationId: auth.orgId },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json({ success: true, data: files })
  } catch (error) {
    console.error("[ticket-files GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("tickets", "write", async (req, auth, context: RouteContext) => {
  const { id } = await context.params
  if (!checkRateLimit(`ticket-file-upload:${auth.userId}`, { maxRequests: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
  }

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, status: true },
    })
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    if (ticket.status === "closed") {
      return NextResponse.json({ error: "ticket_closed", errorKey: "ticketClosed" }, { status: 409 })
    }

    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    const record = await storeTicketAttachment({
      organizationId: auth.orgId,
      ticketId: id,
      uploadedBy: auth.userId,
      file,
    })
    return NextResponse.json({ success: true, data: record }, { status: 201 })
  } catch (error) {
    if (error instanceof TicketAttachmentInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[ticket-files POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
