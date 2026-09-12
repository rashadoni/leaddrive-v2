import crypto from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { validateUploadBytes } from "@/lib/upload-security"

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
  await writeFile(writtenPath, buffer, { flag: "wx" })

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
