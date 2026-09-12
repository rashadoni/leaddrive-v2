import { unlink } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { withRlsAuth } from "@/lib/with-rls"

type RouteContext = { params: Promise<{ id: string; fileId: string }> }

export const DELETE = withRlsAuth("tickets", "write", async (_req, auth, context: RouteContext) => {
  const { id, fileId } = await context.params
  try {
    const file = await prisma.ticketAttachment.findFirst({
      where: {
        id: fileId,
        ticketId: id,
        organizationId: auth.orgId,
        uploadedBy: auth.userId,
        commentId: null,
      },
    })
    if (!file) return NextResponse.json({ error: "Attachment not found" }, { status: 404 })

    const uploadsDir = path.resolve(runtimePublicUploadDirectory("tickets"))
    const filePath = path.resolve(uploadsDir, path.basename(file.fileName))
    if (!filePath.startsWith(`${uploadsDir}${path.sep}`)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
    }

    const deleted = await prisma.ticketAttachment.deleteMany({
      where: {
        id: fileId,
        ticketId: id,
        organizationId: auth.orgId,
        uploadedBy: auth.userId,
        commentId: null,
      },
    })
    if (deleted.count !== 1) {
      return NextResponse.json({ error: "Attachment changed before removal" }, { status: 409 })
    }
    await unlink(filePath).catch(() => undefined)
    return NextResponse.json({ success: true, data: { deleted: fileId } })
  } catch (error) {
    console.error("[ticket-files DELETE]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
