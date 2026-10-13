import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { readAttendanceDayKinds } from "@/lib/mtm/attendance-day-kind-store"
import { agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import {
  AttendanceRequestDetailsSchema, AttendanceRequestError, AttendanceRequestInputSchema,
  attendanceRequestWindowsOverlap, type AttendanceRequestDto, type AttendanceRequestInput,
} from "@/lib/mtm/attendance-request-contract"

export type AttendanceSelf = { organizationId: string; agentId: string; role: string }
export const attendanceRequestSelect = {
  id: true, clientRequestId: true, agentId: true, status: true, startDate: true, endDate: true,
  reason: true, attendanceDetails: true, submittedAt: true, decisionNote: true,
  decidedAt: true, cancelledAt: true, updatedAt: true,
} satisfies Prisma.MtmHrmRequestSelect
type RequestRow = Prisma.MtmHrmRequestGetPayload<{ select: typeof attendanceRequestSelect }>
export function attendanceRequestDto(row: RequestRow): AttendanceRequestDto {
  const parsed = AttendanceRequestDetailsSchema.parse(row.attendanceDetails)
  const details = { version: parsed.version, kind: parsed.kind, unit: parsed.unit,
    startTime: parsed.startTime, endTime: parsed.endTime, timezone: parsed.timezone,
    dayKind: parsed.dayKind, attachmentIds: parsed.attachmentIds }
  return {
    id: row.id, clientRequestId: row.clientRequestId, agentId: row.agentId, status: row.status,
    startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10),
    reason: row.reason, submittedAt: row.submittedAt.toISOString(), decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null,
    version: row.updatedAt.toISOString(), details,
  }
}

/** Independent of the withdrawn Workforce grant/route switches. Called again inside every write. */
export async function requireAttendanceSelf(db: Prisma.TransactionClient, self: AttendanceSelf) {
  const values = await db.mtmSetting.findMany({ where: { organizationId: self.organizationId, key: { in: ["attendanceEnabled", "timezone"] } }, select: { key: true, value: true } })
  if (!agentPermissionEnabled({ attendanceEnabled: values.find((value) => value.key === "attendanceEnabled")?.value === true }, "attendanceRequests")) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DISABLED", 404)
  }
  if (self.role !== "AGENT") throw new AttendanceRequestError("MTM_ATTENDANCE_SELF_REQUIRED", 403)
  const agent = await db.mtmAgent.findFirst({ where: { id: self.agentId, organizationId: self.organizationId, status: "ACTIVE", role: "AGENT" }, select: { id: true } })
  if (!agent) throw new AttendanceRequestError("MTM_ATTENDANCE_SELF_REQUIRED", 403)
  const timezone = values.find((value) => value.key === "timezone")?.value ?? "Asia/Baku"
  if (typeof timezone !== "string" || !isValidTimezone(timezone)) throw new AttendanceRequestError("MTM_ATTENDANCE_TIMEZONE_INVALID", 409)
  return timezone
}
export async function lockAttendanceRequests(db: Prisma.TransactionClient, self: Pick<AttendanceSelf, "organizationId" | "agentId">) {
  await db.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-requests:${self.organizationId}:${self.agentId}`}, 0))`
  // Linearize a submission with disabling attendance or deactivating its owner.
  await db.$queryRaw`SELECT "id" FROM "mtm_settings" WHERE "organizationId" = ${self.organizationId} AND "key" = 'attendanceEnabled' FOR SHARE`
  await db.$queryRaw`SELECT "id" FROM "mtm_agents" WHERE "organizationId" = ${self.organizationId} AND "id" = ${self.agentId} FOR SHARE`
}
function submissionHash(input: AttendanceRequestInput) {
  return createHash("sha256").update(JSON.stringify({ ...input, attachmentIds: [...input.attachmentIds].sort() })).digest("hex")
}
/** Shared by direct mobile API and its outbox adapter; never opens a nested transaction. */
export async function submitAttendanceRequestInTransaction(db: Prisma.TransactionClient, self: AttendanceSelf, raw: unknown) {
  const parsed = AttendanceRequestInputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", 400)
  const input = parsed.data
  await lockAttendanceRequests(db, self)
  const timezone = await requireAttendanceSelf(db, self)
  const hash = submissionHash(input)
  const existing = await db.mtmHrmRequest.findFirst({ where: { organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId }, select: attendanceRequestSelect })
  if (existing) {
    const details = AttendanceRequestDetailsSchema.safeParse(existing.attendanceDetails)
    if (!details.success || details.data.submissionHash !== hash) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_IDEMPOTENCY_MISMATCH")
    return { request: attendanceRequestDto(existing), idempotent: true }
  }
  // Reject nonexistent/ambiguous wall-clock times instead of guessing through DST.
  if (input.unit === "HOURS") {
    try {
      localDateTimeToUnambiguousUtc(`${input.startDate}T${input.startTime}`, timezone)
      localDateTimeToUnambiguousUtc(`${input.endDate}T${input.endTime}`, timezone)
    } catch { throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_LOCAL_TIME_INVALID", 400) }
  }
  const dayKind = (await readAttendanceDayKinds(self.organizationId, db)).items.find((item) => item.key === input.kind && !item.archived)
  if (!dayKind) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_KIND_UNAVAILABLE", 400)
  if (input.attachmentIds.length) {
    const count = await db.mtmAttendanceAttachment.count({ where: { organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId, id: { in: input.attachmentIds } } })
    if (count !== input.attachmentIds.length) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_ATTACHMENTS_INVALID", 400)
  }
  const startDate = new Date(`${input.startDate}T00:00:00Z`)
  const endDate = new Date(`${input.endDate}T00:00:00Z`)
  const overlaps = await db.mtmHrmRequest.findMany({ where: {
    organizationId: self.organizationId, agentId: self.agentId, status: { in: ["PENDING", "APPROVED"] },
    type: { in: ["LEAVE", "ABSENCE"] }, startDate: { lte: endDate }, endDate: { gte: startDate },
  }, select: { startDate: true, endDate: true, attendanceDetails: true }, take: 1001 })
  if (overlaps.length > 1000) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_TOO_MANY")
  for (const row of overlaps) {
    const details = row.attendanceDetails === null ? null : AttendanceRequestDetailsSchema.parse(row.attendanceDetails)
    if (attendanceRequestWindowsOverlap(input, {
      startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10),
      unit: details?.unit ?? "DAYS", startTime: details?.startTime, endTime: details?.endTime,
    })) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_OVERLAP")
  }
  const now = new Date()
  const created = await db.mtmHrmRequest.create({ data: {
    id: randomUUID(), organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId,
    type: input.kind === "ANNUAL_LEAVE" ? "LEAVE" : "ABSENCE", startDate, endDate, reason: input.reason, submittedAt: now,
    attendanceDetails: { version: 1, kind: input.kind, unit: input.unit, startTime: input.startTime ?? null, endTime: input.endTime ?? null,
      timezone, dayKind, attachmentIds: [...input.attachmentIds].sort(), submissionHash: hash },
  }, select: attendanceRequestSelect })
  await db.mtmAuditLog.create({ data: { organizationId: self.organizationId, agentId: self.agentId,
    action: "MTM_ATTENDANCE_REQUEST_SUBMITTED", entity: "hrm_request", entityId: created.id, metadataKind: "mtm_attendance_request",
    newData: { kind: input.kind, startDate: input.startDate, endDate: input.endDate, unit: input.unit, attachmentCount: input.attachmentIds.length },
  } })
  return { request: attendanceRequestDto(created), idempotent: false }
}
export async function submitAttendanceRequest(self: AttendanceSelf, raw: unknown) {
  return prisma.$transaction((db: Prisma.TransactionClient) => submitAttendanceRequestInTransaction(db, self, raw), { timeout: 15_000 })
}
export async function listOwnAttendanceRequests(self: AttendanceSelf, cursor?: string) {
  return prisma.$transaction(async (db: Prisma.TransactionClient) => {
    await requireAttendanceSelf(db, self)
    const before = cursor ? await db.mtmHrmRequest.findFirst({ where: { id: cursor, organizationId: self.organizationId, agentId: self.agentId, attendanceDetails: { not: Prisma.DbNull } }, select: { submittedAt: true } }) : null
    if (cursor && !before) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", 400)
    const rows = await db.mtmHrmRequest.findMany({ where: { organizationId: self.organizationId, agentId: self.agentId,
      attendanceDetails: { not: Prisma.DbNull }, ...(before ? { OR: [{ submittedAt: { lt: before.submittedAt } }, { submittedAt: before.submittedAt, id: { lt: cursor! } }] } : {}),
    }, select: attendanceRequestSelect, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 51 })
    return { items: rows.slice(0, 50).map(attendanceRequestDto), nextCursor: rows.length > 50 ? rows[49].id : null }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
export async function cancelOwnAttendanceRequest(self: AttendanceSelf, id: string) {
  return prisma.$transaction(async (db: Prisma.TransactionClient) => {
    await lockAttendanceRequests(db, self)
    await requireAttendanceSelf(db, self)
    const row = await db.mtmHrmRequest.findFirst({ where: { id, organizationId: self.organizationId, agentId: self.agentId, attendanceDetails: { not: Prisma.DbNull } }, select: attendanceRequestSelect })
    if (!row) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
    if (row.status === "CANCELLED") return { request: attendanceRequestDto(row), idempotent: true }
    if (row.status !== "PENDING") throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_ALREADY_DECIDED")
    const changed = await db.mtmHrmRequest.updateMany({ where: { id, organizationId: self.organizationId, agentId: self.agentId, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date() } })
    if (changed.count !== 1) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
    await db.mtmAuditLog.create({ data: { organizationId: self.organizationId, agentId: self.agentId,
      action: "MTM_ATTENDANCE_REQUEST_CANCELLED", entity: "hrm_request", entityId: id, metadataKind: "mtm_attendance_request", newData: { status: "CANCELLED" },
    } })
    const updated = await db.mtmHrmRequest.findFirst({ where: { id, organizationId: self.organizationId }, select: attendanceRequestSelect })
    if (!updated) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
    return { request: attendanceRequestDto(updated), idempotent: false }
  })
}
