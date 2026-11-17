import { NextResponse } from "next/server"
import { writeFile, mkdir, unlink } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { prisma, logAudit } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRlsAuth } from "@/lib/with-rls"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { TASK_FILE_EXTENSIONS, TASK_FILE_TYPES, taskFileExtension, taskFileStoredType } from "@/lib/tasks/task-file-rules"

/**
 * Files of a deal — the customer's layout, a PDF, a photo, a confirmation
 * (docs/sales-procurement/README.md, task 4.1). The security model of task
 * files: the same allowed types (the layout tools' formats included), bytes
 * checked against the type, sealed with the organization's key on disk under
 * uploads/deal-files/<32-hex>.<ext>, served and tenant-checked by the uploads
 * gate (`/api/v1/uploads/deal-files/<name>`). One request carries up to 10 MB —
 * the Next proxy cuts a longer body.
 */
const SUBDIR = "deal-files"
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FORM_BYTES = MAX_FILE_SIZE + 64 * 1024
type Ctx = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("deals", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const files = await prisma.dealFile.findMany({ where: { dealId: id, organizationId: orgId }, orderBy: { createdAt: "desc" } })
  return NextResponse.json({ success: true, data: files.map((file: { fileName: string }) => ({ ...file, url: `/api/v1/uploads/${SUBDIR}/${file.fileName}` })) })
})

export const POST = withRlsAuth("deals", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  if (!checkRateLimit(`deal-file-upload:${userId}`, { maxRequests: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
  }
  const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true } })
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) {
    return NextResponse.json({ error: "File too large (max 10MB)", refusal: "too_big" }, { status: 413 })
  }
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "The upload arrived incomplete; please send the file again" }, { status: 400 })
  const file = form.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10MB)", refusal: "too_big" }, { status: 400 })
  const mimeType = taskFileStoredType(file.name, file.type)
  if (!mimeType || !TASK_FILE_TYPES.includes(mimeType)) return NextResponse.json({ error: "File type not allowed", refusal: "type" }, { status: 400 })
  const ext = taskFileExtension(file.name)
  if (!ext || !TASK_FILE_EXTENSIONS.has(ext)) return NextResponse.json({ error: "File extension not allowed", refusal: "type" }, { status: 400 })
  const noteValue = form.get("note")
  const note = typeof noteValue === "string" && noteValue.trim() ? noteValue.trim().slice(0, 500) : null

  const buffer = Buffer.from(await file.arrayBuffer())
  const contentError = validateUploadBytes(mimeType, buffer)
  if (contentError) return NextResponse.json({ error: contentError, refusal: "content" }, { status: 400 })
  const uniqueName = `${crypto.randomBytes(16).toString("hex")}${ext}`
  const directory = runtimePublicUploadDirectory(SUBDIR)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, uniqueName), sealTenantFile(orgId, buffer))
  const record = await prisma.dealFile.create({
    data: { organizationId: orgId, dealId: id, fileName: uniqueName, originalName: file.name.slice(0, 300), fileSize: file.size, mimeType, note, uploadedBy: userId },
  })
  logAudit(orgId, "file_added", "deal", id, deal.name, { newValue: { file: record.originalName }, userId })
  return NextResponse.json({ success: true, data: { ...record, url: `/api/v1/uploads/${SUBDIR}/${record.fileName}` } }, { status: 201 })
})

export const DELETE = withRlsAuth("deals", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const fileId = new URL(req.url).searchParams.get("fileId")
  if (!fileId) return NextResponse.json({ error: "fileId is required" }, { status: 400 })
  const file = await prisma.dealFile.findFirst({ where: { id: fileId, dealId: id, organizationId: orgId }, select: { id: true, fileName: true, originalName: true, deal: { select: { name: true } } } })
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 })
  await prisma.dealFile.delete({ where: { id: file.id } })
  // The stored name is ours (32 hex + a whitelisted extension), never a path.
  if (/^[0-9a-f]{32}\.[a-z0-9]{1,5}$/u.test(file.fileName)) {
    await unlink(path.join(runtimePublicUploadDirectory(SUBDIR), file.fileName)).catch(() => {})
  }
  logAudit(orgId, "file_removed", "deal", id, file.deal.name, { oldValue: { file: file.originalName }, userId })
  return NextResponse.json({ success: true })
})
