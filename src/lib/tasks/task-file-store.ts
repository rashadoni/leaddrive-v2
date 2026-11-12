import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"

/**
 * A task's file on disk — one way to store it for the card's upload
 * (POST /api/v1/tasks/[id]/files) and for files brought over from another tool
 * (POST /api/v1/tasks/import-external/files). Stored sealed with the
 * organization's key as uploads/tasks/<32-hex>.<ext>; served by the F-41 gate.
 */
export const MAX_TASK_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const TASK_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  // Bordio moved over (2026-11-07): presentations, voice notes and Outlook
  // messages were attached to the tasks in work and were refused here.
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "audio/ogg",
  "application/vnd.ms-outlook",
]

// Extension whitelist — defends even if the client-supplied MIME is spoofed.
export const TASK_FILE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".csv", ".zip", ".rar",
  ".ogg", ".msg",
])

/** The type a file name stands for, among the allowed ones; null when none. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".ogg": "audio/ogg",
  ".msg": "application/vnd.ms-outlook",
}
export function taskFileTypeOf(name: string): string | null {
  return TYPE_BY_EXTENSION[path.extname(name).toLowerCase()] ?? null
}

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
  if (bytes.length > MAX_TASK_FILE_SIZE) return { ok: false, refusal: "too_big", message: "File too large (max 10MB)" }
  if (!TASK_FILE_TYPES.includes(mimeType)) return { ok: false, refusal: "type", message: "File type not allowed" }
  const ext = path.extname(name).toLowerCase()
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
