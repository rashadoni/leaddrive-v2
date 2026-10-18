import { notifyAttendanceRequestReviewers } from "@/lib/mtm/attendance-request-notify"
import { pushAttendanceRequestToReviewers } from "@/lib/mtm/attendance-request-push"
import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { readAttendanceDayKinds } from "@/lib/mtm/attendance-day-kind-store"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { assertAttendanceRequestQuota, attendanceRequestQuotaUsage } from "@/lib/mtm/attendance-request-quota"
import { readAttendanceRequestLimits } from "@/lib/mtm/attendance-request-limit-store"
import {
  AttendanceRequestDetailsSchema, AttendanceRequestError, AttendanceRequestInputSchema,
  attendanceRequestWindowsOverlap, type AttendanceRequestDto, type AttendanceRequestInput, type AttendanceCorrectionBasis,
} from "@/lib/mtm/attendance-request-contract"

import { requireAttendanceSelf, lockAttendanceRequests, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
export { requireAttendanceSelf, lockAttendanceRequests, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
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
    dayKind: parsed.dayKind, attachmentIds: parsed.attachmentIds,
    ...(parsed.correctionBasis ? { correctionBasis: parsed.correctionBasis } : {}) }
  return {
    id: row.id, clientRequestId: row.clientRequestId, agentId: row.agentId, status: row.status,
    startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10),
    reason: row.reason, submittedAt: row.submittedAt.toISOString(), decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null,
    version: row.updatedAt.toISOString(), details,
  }
}

function submissionHash(input: AttendanceRequestInput) {
  return createHash("sha256").update(JSON.stringify({ ...input, attachmentIds: [...input.attachmentIds].sort() })).digest("hex")
}
/** Shared by direct mobile API and its outbox adapter; never opens a nested transaction. */
export async function submitAttendanceRequestInTransaction(db: Prisma.TransactionClient, self: AttendanceSelf, raw: unknown) {
  const parsed = AttendanceRequestInputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", 400)
  const input = parsed.data
  if (input.kind === "TIME_CORRECTION") {
    await db.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    await lockMtmWorkdayTransitions(db, self)
  }
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
  let requestedStartAt: Date | null = null
  let requestedEndAt: Date | null = null
  if (input.unit === "HOURS") {
    try {
      const start = localDateTimeToUnambiguousUtc(`${input.startDate}T${input.startTime}`, timezone)
      const end = localDateTimeToUnambiguousUtc(`${input.endDate}T${input.endTime}`, timezone)
      if (end <= start || (input.endDate !== input.startDate && end.getTime() - start.getTime() > 86_400_000)) {
        throw new Error("Invalid elapsed request interval")
      }
      if (input.kind === "TIME_CORRECTION") { requestedStartAt = start; requestedEndAt = end }
    } catch { throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_LOCAL_TIME_INVALID", 400) }
  }
  const dayKind = (await readAttendanceDayKinds(self.organizationId, db)).items.find((item) => item.key === (input.kind === "TIME_CORRECTION" ? "WORKED" : input.kind) && !item.archived)
  if (!dayKind) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_KIND_UNAVAILABLE", 400)
  if (input.attachmentIds.length) {
    const count = await db.mtmAttendanceAttachment.count({ where: { organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId, id: { in: input.attachmentIds } } })
    if (count !== input.attachmentIds.length) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_ATTACHMENTS_INVALID", 400)
  }
  const startDate = new Date(`${input.startDate}T00:00:00Z`)
  const endDate = new Date(`${input.endDate}T00:00:00Z`)
  let correctionBasis: AttendanceCorrectionBasis | undefined
  let correctionWorkdayId: string | null = null
  if (input.kind === "TIME_CORRECTION") {
    if (!requestedStartAt || !requestedEndAt || requestedEndAt.getTime() > Date.now()) throw new AttendanceRequestError("MTM_ATTENDANCE_CORRECTION_FUTURE", 400)
    const workday = await db.mtmAgentWorkday.findFirst({ where: { organizationId: self.organizationId, agentId: self.agentId, workDate: startDate },
      select: { id: true, workDate: true, status: true, startedAt: true, completedAt: true, pausedAt: true, totalPausedSeconds: true } })
    if (workday) {
      correctionWorkdayId = workday.id
      correctionBasis = { kind: "WORKDAY", facts: workforceWorkdayCorrectionFacts(workday) }
      if (workday.status === "COMPLETED" && workday.startedAt.getTime() === requestedStartAt.getTime() && workday.completedAt?.getTime() === requestedEndAt.getTime()) {
        throw new AttendanceRequestError("MTM_ATTENDANCE_CORRECTION_UNCHANGED")
      }
    } else correctionBasis = { kind: "MISSING", workDate: input.startDate }
    const pending = await db.mtmHrmRequest.findFirst({ where: { organizationId: self.organizationId, agentId: self.agentId, type: "TIME_CORRECTION", status: "PENDING", startDate }, select: { id: true } })
    if (pending) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_OVERLAP")
  }
  const overlaps = input.kind === "TIME_CORRECTION" ? [] : await db.mtmHrmRequest.findMany({ where: {
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
  await assertAttendanceRequestQuota(db, self, input, timezone)
  const created = await db.mtmHrmRequest.create({ data: {
    id: randomUUID(), organizationId: self.organizationId, agentId: self.agentId, clientRequestId: input.clientRequestId,
    type: input.kind === "TIME_CORRECTION" ? "TIME_CORRECTION" : input.kind === "ANNUAL_LEAVE" ? "LEAVE" : "ABSENCE", startDate, endDate, reason: input.reason, submittedAt: now,
    correctionWorkdayId, requestedStartAt, requestedEndAt,
    attendanceDetails: { version: 1, kind: input.kind, unit: input.unit, startTime: input.startTime ?? null, endTime: input.endTime ?? null,
      timezone, dayKind, attachmentIds: [...input.attachmentIds].sort(), submissionHash: hash, ...(correctionBasis ? { correctionBasis } : {}) },
  }, select: attendanceRequestSelect })
  await db.mtmAuditLog.create({ data: { organizationId: self.organizationId, agentId: self.agentId,
    action: "MTM_ATTENDANCE_REQUEST_SUBMITTED", entity: "hrm_request", entityId: created.id, metadataKind: "mtm_attendance_request",
    newData: { kind: input.kind, startDate: input.startDate, endDate: input.endDate, unit: input.unit, attachmentCount: input.attachmentIds.length },
  } })
  await notifyAttendanceRequestReviewers(db, { organizationId: self.organizationId, agentId: self.agentId, requestId: created.id })
  return { request: attendanceRequestDto(created), idempotent: false }
}
export async function submitAttendanceRequest(self: AttendanceSelf, raw: unknown) {
  const result = await prisma.$transaction((db: Prisma.TransactionClient) => submitAttendanceRequestInTransaction(db, self, raw), { timeout: 15_000 })
  // After the commit: the manager's phone hears of it (attendance-request-push.ts).
  // A replayed submission was announced the first time.
  if (!result.idempotent) {
    void pushAttendanceRequestToReviewers({ organizationId: self.organizationId, agentId: self.agentId, request: result.request })
      .catch((error) => console.warn("[mtm/attendance] request push failed", error instanceof Error ? error.message : error))
  }
  return result
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

export async function readOwnAttendanceRequestQuota(self: AttendanceSelf, month: string) {
  return prisma.$transaction(async (db: Prisma.TransactionClient) => {
    await requireAttendanceSelf(db, self)
    const limits = await readAttendanceRequestLimits(self.organizationId, db)
    const usage = await attendanceRequestQuotaUsage(db, self, month)
    return { month, limits, ...usage, remainingMinutes: Math.max(0, limits.monthlyMinutes - usage.usedMinutes),
      remainingRequests: Math.max(0, limits.monthlyRequests - usage.usedRequests) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
