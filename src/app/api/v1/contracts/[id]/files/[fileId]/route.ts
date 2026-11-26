import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unlink } from "fs/promises"
import path from "path"
import { withRlsAuth } from "@/lib/with-rls"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { SIGNED_COPY_PURPOSE } from "@/lib/clm/paper-signature"
import { TERMINATION_COPY_PURPOSE } from "@/lib/clm/contract-closing"

export const DELETE = withRlsAuth("contracts", "delete", async (_req, authResult, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
  const orgId = authResult.orgId
  const { id, fileId } = await params

  try {
    const file = await prisma.contractFile.findFirst({
      where: { id: fileId, contractId: id, organizationId: orgId },
    })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    // The scan behind «Подписан на бумаге» and the signed termination agreement are evidence.
    if (file.purpose === SIGNED_COPY_PURPOSE || file.purpose === TERMINATION_COPY_PURPOSE) {
      return NextResponse.json({ error: "The signed copy cannot be deleted", code: "SIGNED_COPY_LOCKED" }, { status: 409 })
    }

    // Prevent path traversal — strip directory components and verify resolved path
    const uploadsDir = runtimePublicUploadDirectory("contracts")
    const filePath = path.resolve(uploadsDir, path.basename(file.fileName))
    if (!filePath.startsWith(uploadsDir)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
    }

    // Delete from disk
    await unlink(filePath).catch(() => {})

    // Delete from DB
    await prisma.contractFile.delete({ where: { id: fileId } })

    return NextResponse.json({ success: true, data: { deleted: fileId } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
