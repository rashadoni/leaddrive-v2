import { createHash, randomBytes, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { mkdir, open, writeFile } from "node:fs/promises"
import path from "node:path"
import { Prisma } from "@prisma/client"
import sharp from "sharp"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { resolveRuntimePaths } from "@/lib/runtime-paths"
import { AttendanceRequestDetailsSchema, AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { lockAttendanceRequests, requireAttendanceSelf, type AttendanceSelf } from "@/lib/mtm/attendance-request-store"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

export const MAX_ATTENDANCE_ATTACHMENT_BYTES = 5 * 1024 * 1024
const uploadSchema = z.object({ clientRequestId: z.string().uuid(), clientAttachmentId: z.string().uuid() }).strict()
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
export function attendanceAttachmentPath(key: string) {
  if (!/^[a-f0-9]{48}$/.test(key)) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
  return path.join(resolveRuntimePaths().privateUploadsRoot, "mtm-attendance", key)
}
/** Re-encode the image so EXIF (including location), embedded previews and active formats are never retained. */
export async function prepareAttendanceDocument(bytes: Uint8Array) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATTENDANCE_ATTACHMENT_BYTES) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_SIZE", 413)
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "error", animated: false })
    const metadata = await image.metadata()
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("format")
    const data = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    if (data.length > MAX_ATTENDANCE_ATTACHMENT_BYTES) throw new Error("size")
    return { bytes: data, sourceSha256: sha256(bytes), checksumSha256: sha256(data) }
  } catch { throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_IMAGE_REQUIRED", 400) }
}
export async function uploadAttendanceDocument(self: AttendanceSelf, raw: unknown, bytes: Uint8Array) {
  await requireAttendanceSelf(prisma, self)
  const parsed = uploadSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_INVALID", 400)
  const input = parsed.data
  const prepared = await prepareAttendanceDocument(bytes)
  return prisma.$transaction(async (db: Prisma.TransactionClient) => {
    await lockAttendanceRequests(db, self)
    await requireAttendanceSelf(db, self)
    const existing = await db.mtmAttendanceAttachment.findFirst({ where: { organizationId: self.organizationId, agentId: self.agentId, clientAttachmentId: input.clientAttachmentId } })
    if (existing) {
      if (existing.clientRequestId !== input.clientRequestId || existing.sourceSha256 !== prepared.sourceSha256) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_IDEMPOTENCY_MISMATCH")
      return { id: existing.id, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes, idempotent: true }
    }
    const request = await db.mtmHrmRequest.findFirst({ where: { organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId }, select: { id: true } })
    if (request) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_REQUEST_SUBMITTED")
    const count = await db.mtmAttendanceAttachment.count({ where: { organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId } })
    if (count >= 3) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_LIMIT", 400)
    const recent = await db.mtmAttendanceAttachment.count({ where: { organizationId: self.organizationId, agentId: self.agentId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })
    if (recent >= 60) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_DAILY_LIMIT", 429)
    const key = randomBytes(24).toString("hex")
    const location = attendanceAttachmentPath(key)
    await mkdir(path.dirname(location), { recursive: true, mode: 0o700 })
    await writeFile(location, prepared.bytes, { flag: "wx", mode: 0o600 })
    // On an ambiguous commit response preserve this private file: deleting it
    // could break an already committed request. No URL exists without a DB row.
    const record = await db.mtmAttendanceAttachment.create({ data: {
      id: randomUUID(), organizationId: self.organizationId, agentId: self.agentId, ...input,
      storageKey: key, sourceSha256: prepared.sourceSha256, checksumSha256: prepared.checksumSha256,
      sizeBytes: prepared.bytes.length, mimeType: "image/jpeg",
    }, select: { id: true, mimeType: true, sizeBytes: true } })
    return { ...record, idempotent: false }
  }, { timeout: 15_000 })
}

type Reader = { organizationId: string } & ({ self: AttendanceSelf; actor?: never } | { actor: MtmRouteActor; self?: never })
export async function readAttendanceDocument(reader: Reader, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
  if (reader.self) await requireAttendanceSelf(prisma, reader.self)
  if (reader.actor?.role === "AGENT") throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
  const record = await prisma.mtmAttendanceAttachment.findFirst({ where: {
    id, organizationId: reader.organizationId,
    ...(reader.self ? { agentId: reader.self.agentId } : reader.actor?.scopedAgentIds !== null ? { agentId: { in: reader.actor?.scopedAgentIds ?? [] } } : {}),
  } })
  if (!record) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
  // A reviewer never sees unsubmitted or unselected photos from a draft.
  if (!reader.self) {
    const request = await prisma.mtmHrmRequest.findFirst({ where: { organizationId: reader.organizationId, agentId: record.agentId, clientRequestId: record.clientRequestId }, select: { attendanceDetails: true } })
    const details = AttendanceRequestDetailsSchema.safeParse(request?.attendanceDetails)
    if (!details.success || !details.data.attachmentIds.includes(id)) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
  }
  try {
    const file = await open(attendanceAttachmentPath(record.storageKey), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== record.sizeBytes || stat.size > MAX_ATTENDANCE_ATTACHMENT_BYTES) throw new Error("size")
      const bytes = await file.readFile()
      if (sha256(bytes) !== record.checksumSha256) throw new Error("checksum")
      return { bytes, mimeType: record.mimeType }
    } finally { await file.close() }
  } catch { throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404) }
}
