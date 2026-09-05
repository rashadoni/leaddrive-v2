import { readFile, unlink } from "node:fs/promises"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getPortalUser } from "@/lib/portal-auth"
import { runWithTenant } from "@/lib/rls-context"
import {
  resolveTicketAttachmentPath,
  TICKET_ATTACHMENT_MAX_FILE_SIZE,
} from "@/lib/ticketing/ticket-attachment-storage"

type RouteContext = { params: Promise<{ id: string; fileId: string }> }

function contentDisposition(fileName: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

async function ownedTicket(organizationId: string, contactId: string, ticketId: string) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, organizationId, contactId },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: ticketId, fileId } = await context.params

  return runWithTenant(user.organizationId, async () => {
    if (!(await ownedTicket(user.organizationId, user.contactId, ticketId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const file = await prisma.ticketAttachment.findFirst({
      where: {
        id: fileId,
        organizationId: user.organizationId,
        ticketId,
        OR: [
          { comment: { is: { isInternal: false } } },
          { commentId: null, uploadedBy: user.contactId },
        ],
      },
      select: { fileName: true, originalName: true, fileSize: true, mimeType: true },
    })
    if (!file || file.fileSize < 0 || file.fileSize > TICKET_ATTACHMENT_MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const filePath = resolveTicketAttachmentPath(file.fileName)
    if (!filePath) return NextResponse.json({ error: "Not found" }, { status: 404 })
    try {
      const bytes = await readFile(filePath)
      if (bytes.byteLength !== file.fileSize || bytes.byteLength > TICKET_ATTACHMENT_MAX_FILE_SIZE) {
        return NextResponse.json({ error: "File unavailable" }, { status: 410 })
      }
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": file.mimeType || "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": contentDisposition(file.originalName),
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Vary": "Cookie, Authorization",
        },
      })
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  })
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: ticketId, fileId } = await context.params

  return runWithTenant(user.organizationId, async () => {
    if (!(await ownedTicket(user.organizationId, user.contactId, ticketId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const file = await prisma.ticketAttachment.findFirst({
      where: {
        id: fileId,
        organizationId: user.organizationId,
        ticketId,
        uploadedBy: user.contactId,
        commentId: null,
      },
      select: { fileName: true },
    })
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const deleted = await prisma.ticketAttachment.deleteMany({
      where: {
        id: fileId,
        organizationId: user.organizationId,
        ticketId,
        uploadedBy: user.contactId,
        commentId: null,
      },
    })
    if (deleted.count !== 1) {
      return NextResponse.json({ error: "Attachment changed before removal" }, { status: 409 })
    }
    const filePath = resolveTicketAttachmentPath(file.fileName)
    if (filePath) await unlink(filePath).catch(() => undefined)
    return NextResponse.json({ success: true, data: { deleted: fileId } })
  })
}
