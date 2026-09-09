import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unlink } from "fs/promises"
import path from "path"
import { withRlsAuth } from "@/lib/with-rls"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

export const DELETE = withRlsAuth("tasks", "delete", async (req, auth, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
  const { id, fileId } = await params

  try {
    const file = await prisma.taskAttachment.findFirst({
      where: { id: fileId, taskId: id, organizationId: auth.orgId },
    })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })

    // Path-traversal defense — strip directory components, verify resolved path
    // stays under the tasks uploads dir before unlinking.
    const uploadsDir = runtimePublicUploadDirectory("tasks")
    const filePath = path.resolve(uploadsDir, path.basename(file.fileName))
    if (!filePath.startsWith(uploadsDir)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
    }

    await unlink(filePath).catch(() => {})
    await prisma.taskAttachment.delete({ where: { id: fileId } })

    return NextResponse.json({ success: true, data: { deleted: fileId } })
  } catch (e) {
    console.error("[task-files DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
