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
/**
 * The most a task file may weigh. Owner, 2026-11-12: videos and design files
 * up to 100 MB («Да, разрешить») — Bordio's reels, brand books and CorelDraw
 * sources were left behind at 10 MB. The card's own upload keeps 10 MB: its
 * body crosses nginx (20 MB) and the Next proxy (10 MB) first.
 */
export const MAX_TASK_FILE_SIZE = 100 * 1024 * 1024

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
  // Owner, 2026-11-12: the marketing team's videos and design sources.
  "video/mp4",
  "video/quicktime",
  "application/zip",
  "application/vnd.corel-draw",
  "image/vnd.adobe.photoshop",
  "application/rtf",
  "message/rfc822",
]

// Extension whitelist — defends even if the client-supplied MIME is spoofed.
export const TASK_FILE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".csv", ".zip", ".rar",
  ".ogg", ".msg",
  ".mp4", ".mov", ".cdr", ".psd", ".rtf", ".eml",
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
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".zip": "application/zip",
  ".cdr": "application/vnd.corel-draw",
  ".psd": "image/vnd.adobe.photoshop",
  ".rtf": "application/rtf",
  ".eml": "message/rfc822",
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
  if (bytes.length > MAX_TASK_FILE_SIZE) return { ok: false, refusal: "too_big", message: "File too large (max 100MB)" }
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
