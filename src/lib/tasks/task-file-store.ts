import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { MAX_TASK_FILE_SIZE, TASK_FILE_EXTENSIONS, TASK_FILE_TYPES, taskFileExtension } from "@/lib/tasks/task-file-rules"

/**
 * A task's file on disk — one way to store it for the card's upload
 * (POST /api/v1/tasks/[id]/files) and for files brought over from another tool
 * (POST /api/v1/tasks/import-external/files). Stored sealed with the
 * organization's key as uploads/tasks/<32-hex>.<ext>; served by the F-41 gate.
 */
export { MAX_TASK_FILE_SIZE, TASK_FILE_EXTENSIONS, TASK_FILE_TYPES, taskFileTypeOf } from "@/lib/tasks/task-file-rules"

export type StoreRefusal = "too_big" | "type" | "extension" | "content"

/** Checks and writes the bytes, then the row. A refusal writes nothing. */
export async function storeTaskFile(args: {
  organizationId: string
  taskId: string
  userId: string | null
  name: string
  mimeType: string
  bytes: Buffer
}): Promise<{ ok: true; id: string } | { ok: false; refusal: StoreRefusal; message: string }> {
  const { organizationId, taskId, userId, name, bytes } = args
  const mimeType = args.mimeType.toLowerCase().trim()
  if (bytes.length > MAX_TASK_FILE_SIZE) return { ok: false, refusal: "too_big", message: "File too large (max 100MB)" }
  if (!TASK_FILE_TYPES.includes(mimeType)) return { ok: false, refusal: "type", message: "File type not allowed" }
  const ext = taskFileExtension(name)
  if (!ext || !TASK_FILE_EXTENSIONS.has(ext)) return { ok: false, refusal: "extension", message: "File extension not allowed" }
  const contentError = validateUploadBytes(mimeType, bytes)
  if (contentError) return { ok: false, refusal: "content", message: contentError }

  const uniqueName = `${crypto.randomBytes(16).toString("hex")}${ext}`
  const uploadDir = runtimePublicUploadDirectory("tasks")
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, uniqueName), sealTenantFile(organizationId, bytes))
  const record = await prisma.taskAttachment.create({
    data: { organizationId, taskId, fileName: uniqueName, originalName: name, fileSize: bytes.length, mimeType, uploadedBy: userId },
  })
  return { ok: true, id: record.id }
}
