import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRlsAuth } from "@/lib/with-rls"
import { refusedTaskIds, NOT_YOUR_TASK } from "@/lib/tasks/task-ownership"
import { writeFile, mkdir, unlink } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { TASK_FILE_EXTENSIONS, TASK_FILE_TYPES, taskFileTypeOf } from "@/lib/tasks/task-file-store"

// Task file attachments — mirrors the ContractFile route's security model
// (src/app/api/v1/contracts/[id]/files/route.ts). Stored on disk as
// public/uploads/tasks/<32-hex>.<ext>; served + org-checked by the F-41 gate.
// The allowed types are the task's own (lib/tasks/task-file-store.ts); a card
// upload stays at 10 MB, as its body crosses nginx and the Next proxy first.
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const GET = withRlsAuth("tasks", "read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const task = await prisma.task.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null } })
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const files = await prisma.taskAttachment.findMany({
      where: { taskId: id, organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: files })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  if (!checkRateLimit(`task-file-upload:${auth.userId}`, { maxRequests: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
  }

  try {
    const task = await prisma.task.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 })
    // A browser names no type for a CorelDraw file and «octet-stream» for some
    // photos: then the name's extension says it (the bytes are checked below).
    const given = file.type.toLowerCase().trim()
    const mimeType = TASK_FILE_TYPES.includes(given) ? given : taskFileTypeOf(file.name) ?? given
    if (!TASK_FILE_TYPES.includes(mimeType)) return NextResponse.json({ error: "File type not allowed" }, { status: 400 })

    const ext = path.extname(file.name).toLowerCase()
    if (!ext || !TASK_FILE_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: "File extension not allowed" }, { status: 400 })
    }

    const uniqueName = `${crypto.randomBytes(16).toString("hex")}${ext}`
    const uploadDir = runtimePublicUploadDirectory("tasks")
    await mkdir(uploadDir, { recursive: true })
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentError = validateUploadBytes(mimeType, buffer)
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 })
    await writeFile(path.join(uploadDir, uniqueName), sealTenantFile(auth.orgId, buffer))

    const record = await prisma.taskAttachment.create({
      data: {
        organizationId: auth.orgId,
        taskId: id,
        fileName: uniqueName,
        originalName: file.name,
        fileSize: file.size,
        mimeType,
        uploadedBy: auth.userId,
      },
    })

    return NextResponse.json({ success: true, data: record }, { status: 201 })
  } catch (e) {
    console.error("[task-files POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * Remove one file of the task (Zeytun, 2026-11-12: «əlavə olunanları da silmək
 * olmur»). Whoever may add a file to the task may remove one — the same right
 * as the upload above. The row goes in any case; the bytes on disk follow, and
 * a file already missing there is not an error.
 */
export const DELETE = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const fileId = new URL(req.url).searchParams.get("fileId")
  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 })
  try {
    const task = await prisma.task.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null }, select: { id: true } })
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })
    const file = await prisma.taskAttachment.findFirst({ where: { id: fileId, taskId: id, organizationId: auth.orgId } })
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
    // A file of a board task goes by the hand of the task's people, or of whoever added it (task-ownership.ts).
    if (file.uploadedBy !== auth.userId && (await refusedTaskIds(prisma, auth.orgId, auth.role, auth.userId, [id], "manage")).length > 0) {
      return NextResponse.json({ error: "Forbidden", message: NOT_YOUR_TASK }, { status: 403 })
    }
    await prisma.taskAttachment.delete({ where: { id: file.id } })
    // The stored name is ours (32 hex + a whitelisted extension), never a path.
    if (/^[0-9a-f]{32}\.[a-z0-9]{1,5}$/u.test(file.fileName)) {
      await unlink(path.join(runtimePublicUploadDirectory("tasks"), file.fileName)).catch(() => {})
    }
    await prisma.taskActivity.create({
      data: { organizationId: auth.orgId, taskId: id, userId: auth.userId, action: "file_removed", oldValue: file.originalName },
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[task-files DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

