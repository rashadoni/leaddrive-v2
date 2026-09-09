import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { sendEmail } from "@/lib/email"
import { writeFile, mkdir, unlink } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { runtimePrivateUploadDirectory } from "@/lib/runtime-paths"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
const MAX_FILES = 3

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
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-rar-compressed",
])

const SAFE_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".webp",
  ".txt", ".csv", ".zip", ".rar",
])

const UPLOAD_DIR = runtimePrivateUploadDirectory("email-attachments")

async function cleanupFiles(filePaths: string[]) {
  for (const fp of filePaths) {
    try { await unlink(fp) } catch { /* ignore */ }
  }
}

export const POST = withRlsAuth(undefined, undefined, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id: dealId } = await params

  // Parse FormData
  const formData = await req.formData()
  const contactId = formData.get("contactId") as string | null
  const subject = formData.get("subject") as string | null
  const body = formData.get("body") as string | null

  if (!contactId || !subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "contactId, subject, and body are required" }, { status: 400 })
  }

  if (subject.length > 500 || body.length > 10000) {
    return NextResponse.json({ error: "Subject or body too long" }, { status: 400 })
  }

  // Verify deal belongs to org
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId: auth.orgId },
    select: { id: true, name: true },
  })
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  }

  // Get contact with email
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: auth.orgId },
    select: { id: true, fullName: true, email: true },
  })
  if (!contact || !contact.email) {
    return NextResponse.json({ error: "Contact not found or has no email" }, { status: 400 })
  }

  // Process file attachments
  const files = formData.getAll("files") as File[]
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Max ${MAX_FILES} attachments allowed` }, { status: 400 })
  }

  const savedPaths: string[] = []
  const attachments: { filename: string; path: string }[] = []

  if (files.length > 0) {
    await mkdir(UPLOAD_DIR, { recursive: true })

    for (const file of files) {
      // Skip empty entries (FormData may include empty file fields)
      if (!file || !file.name || file.size === 0) continue

      // Size check
      if (file.size > MAX_FILE_SIZE) {
        await cleanupFiles(savedPaths)
        return NextResponse.json({ error: `File "${file.name}" exceeds 10MB limit` }, { status: 400 })
      }

      // MIME type check
      if (!ALLOWED_TYPES.has(file.type)) {
        await cleanupFiles(savedPaths)
        return NextResponse.json({ error: `File type "${file.type}" not allowed` }, { status: 400 })
      }

      // Extension check
      const ext = path.extname(file.name).toLowerCase()
      if (!ext || !SAFE_EXTENSIONS.has(ext)) {
        await cleanupFiles(savedPaths)
        return NextResponse.json({ error: `File extension "${ext}" not allowed` }, { status: 400 })
      }

      // Save with crypto filename
      const safeName = `${crypto.randomBytes(16).toString("hex")}${ext}`
      const filePath = path.join(UPLOAD_DIR, safeName)
      const buffer = Buffer.from(await file.arrayBuffer())
      await writeFile(filePath, buffer)

      savedPaths.push(filePath)
      attachments.push({ filename: file.name, path: filePath })
    }
  }

  // Convert plain text body to HTML
  const htmlBody = body
    .split("\n")
    .map((line) => `<p>${line || "&nbsp;"}</p>`)
    .join("")

  // Send email via SMTP
  const result = await sendEmail({
    to: contact.email,
    subject: subject.trim(),
    html: htmlBody,
    organizationId: auth.orgId,
    contactId: contact.id,
    sentBy: auth.userId,
    attachments: attachments.length > 0 ? attachments : undefined,
  })

  // Cleanup temp files after send
  await cleanupFiles(savedPaths)

  // Create activity record
  const attachmentNames = attachments.map(a => a.filename)
  await prisma.activity.create({
    data: {
      organizationId: auth.orgId,
      createdBy: auth.userId,
      type: "email",
      subject: subject.trim(),
      description: attachmentNames.length > 0
        ? `${body.trim()}\n\n📎 ${attachmentNames.join(", ")}`
        : body.trim(),
      contactId: contact.id,
      relatedType: "deal",
      relatedId: dealId,
    },
  })

  return NextResponse.json({
    success: true,
    emailSent: result.success,
    emailError: result.error || null,
    recipientName: contact.fullName,
    recipientEmail: contact.email,
    attachmentCount: attachments.length,
  }, { status: 201 })
})
