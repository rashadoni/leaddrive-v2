import crypto from "node:crypto"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { validateUploadBytes } from "@/lib/upload-security"
import { openTenantFileBytes, sealTenantFile } from "@/lib/crypto/tenant-file-encryption"

export const TICKET_ATTACHMENT_MAX_FILE_SIZE = 10 * 1024 * 1024
export const TICKET_ATTACHMENT_MAX_FILES = 50

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
])
const SAFE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".csv",
])

export class TicketAttachmentInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = "TicketAttachmentInputError"
  }
}

/** Validate bytes once and persist a recoverable, unbound composer upload. */
export async function storeTicketAttachment(input: {
  organizationId: string
  ticketId: string
  uploadedBy: string
  file: File
}) {
  const existingCount = await prisma.ticketAttachment.count({
    where: { ticketId: input.ticketId, organizationId: input.organizationId },
  })
  if (existingCount >= TICKET_ATTACHMENT_MAX_FILES) {
    throw new TicketAttachmentInputError("Attachment limit reached", 409)
  }

  const { file } = input
  if (file.size <= 0) throw new TicketAttachmentInputError("File is empty")
  if (file.size > TICKET_ATTACHMENT_MAX_FILE_SIZE) {
    throw new TicketAttachmentInputError("File too large (max 10MB)")
  }
  if (file.name.length > 255) throw new TicketAttachmentInputError("File name is too long")

  const mimeType = file.type.toLowerCase().trim()
  if (!ALLOWED_TYPES.has(mimeType)) throw new TicketAttachmentInputError("File type not allowed")
  const extension = path.extname(file.name).toLowerCase()
  if (!extension || !SAFE_EXTENSIONS.has(extension)) {
    throw new TicketAttachmentInputError("File extension not allowed")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const contentError = validateUploadBytes(mimeType, buffer)
  if (contentError) throw new TicketAttachmentInputError(contentError)

  const uploadDirectory = runtimePublicUploadDirectory("tickets")
  await mkdir(uploadDirectory, { recursive: true })
  const fileName = `${crypto.randomBytes(16).toString("hex")}${extension}`
  const writtenPath = path.join(uploadDirectory, fileName)
  await writeFile(writtenPath, sealTenantFile(input.organizationId, buffer), { flag: "wx" })

  try {
    return await prisma.ticketAttachment.create({
      data: {
        organizationId: input.organizationId,
        ticketId: input.ticketId,
        fileName,
        originalName: file.name,
        fileSize: file.size,
        mimeType,
        uploadedBy: input.uploadedBy,
      },
    })
  } catch (error) {
    await unlink(writtenPath).catch(() => undefined)
    throw error
  }
}

export function resolveTicketAttachmentPath(fileName: string): string | null {
  const uploadDirectory = path.resolve(runtimePublicUploadDirectory("tickets"))
  const filePath = path.resolve(uploadDirectory, path.basename(fileName))
  return filePath.startsWith(`${uploadDirectory}${path.sep}`) ? filePath : null
}

/** The messenger folders whose stored media a ticket can take a copy of. */
const CHANNEL_MEDIA_DIRS = new Set(["whatsapp", "telegram"])

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".pdf": "application/pdf",
}

/**
 * The file a channel message points at (`/uploads/whatsapp/<org>/<name>`), when it is this
 * organization's own and nowhere else.
 */
function storedChannelMediaPath(mediaUrl: string | null | undefined, organizationId: string): string | null {
  const parts = (mediaUrl ?? "").split("/").filter(Boolean)
  if (parts.length !== 4 || parts[0] !== "uploads" || !CHANNEL_MEDIA_DIRS.has(parts[1])) return null
  if (parts[2] !== organizationId || parts[3] !== path.basename(parts[3]) || parts[3].startsWith(".")) return null
  const root = path.resolve(runtimePublicUploadDirectory(parts[1]), organizationId)
  const filePath = path.resolve(root, parts[3])
  return filePath.startsWith(`${root}${path.sep}`) ? filePath : null
}

/**
 * A customer's photo or document from WhatsApp/Telegram, on the ticket comment that carries its
 * message (owner, 2026-11-10: «фотографии не загружаются… когда пишут» — the comment said
 * «[Изображение]» and nothing else). The file is copied into the ticket's own attachments: a ticket
 * is read by people who may have no access to the inbox, and its files are served by the ticket's
 * rights. Best-effort — a message without a file, a type tickets do not take, or any failure leaves
 * the comment as it was.
 */
export async function attachChannelMediaToTicketComment(input: {
  organizationId: string
  ticketId: string
  commentId: string
  channelMessageId: string
}): Promise<boolean> {
  try {
    const message = await prisma.channelMessage.findFirst({
      where: { id: input.channelMessageId, organizationId: input.organizationId },
      select: { mediaUrl: true, channelType: true },
    })
    const source = storedChannelMediaPath(message?.mediaUrl, input.organizationId)
    if (!source) return false
    const extension = path.extname(source).toLowerCase()
    const mimeType = MIME_BY_EXTENSION[extension]
    if (!mimeType) return false

    const bytes = await openTenantFileBytes(input.organizationId, await readFile(source))
    if (bytes.byteLength === 0 || bytes.byteLength > TICKET_ATTACHMENT_MAX_FILE_SIZE) return false
    if (validateUploadBytes(mimeType, bytes)) return false

    const uploadDirectory = runtimePublicUploadDirectory("tickets")
    await mkdir(uploadDirectory, { recursive: true })
    const fileName = `${crypto.randomBytes(16).toString("hex")}${extension}`
    const writtenPath = path.join(uploadDirectory, fileName)
    await writeFile(writtenPath, sealTenantFile(input.organizationId, bytes), { flag: "wx" })
    try {
      await prisma.ticketAttachment.create({
        data: {
          organizationId: input.organizationId,
          ticketId: input.ticketId,
          commentId: input.commentId,
          fileName,
          originalName: `${message?.channelType || "channel"}-${path.basename(source)}`,
          fileSize: bytes.byteLength,
          mimeType,
          uploadedBy: null,
        },
      })
    } catch (error) {
      await unlink(writtenPath).catch(() => undefined)
      throw error
    }
    return true
  } catch (error) {
    console.error("[ticket attachment] channel media not attached:", error instanceof Error ? error.message : "unknown error")
    return false
  }
}
