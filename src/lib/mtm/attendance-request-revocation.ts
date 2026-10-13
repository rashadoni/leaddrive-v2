import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceRevocationInputSchema, canRevokeAttendanceLeave, type AttendanceRevocation } from "@/lib/mtm/attendance-revocation-contract"
import { attendanceRequestDto, attendanceRequestSelect, lockAttendanceRequests } from "@/lib/mtm/attendance-request-store"
import { requireAttendanceReviewer, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

export const ATTENDANCE_REVOCATION_ACTION = "MTM_ATTENDANCE_APPROVAL_REVOKED"
const auditSchema = z.object({ status: z.literal("CANCELLED"), sourceVersion: z.string().datetime(), reason: z.string().min(3).max(1000) })
export async function readAttendanceRevocations(tx: Prisma.TransactionClient, organizationId: string, requestIds: string[]) {
  if (!requestIds.length) return new Map<string, AttendanceRevocation>()
  const rows = await tx.mtmAuditLog.findMany({ where: { organizationId, action: ATTENDANCE_REVOCATION_ACTION, entity: "hrm_request", entityId: { in: requestIds } },
    select: { entityId: true, actorUserId: true, createdAt: true, newData: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: requestIds.length + 1 })
  if (rows.length > requestIds.length) throw new AttendanceRequestError("MTM_ATTENDANCE_REVOCATION_HISTORY_INVALID")
  const userIds = [...new Set(rows.flatMap(row => row.actorUserId ? [row.actorUserId] : []))]
  const users = userIds.length ? await tx.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, name: true } }) : []
  const names = new Map(users.map(user => [user.id, user.name]))
  const result = new Map<string, AttendanceRevocation>()
  for (const row of rows) {
    const data = auditSchema.safeParse(row.newData)
    if (!data.success || !row.entityId || result.has(row.entityId)) throw new AttendanceRequestError("MTM_ATTENDANCE_REVOCATION_HISTORY_INVALID")
    result.set(row.entityId, { at: row.createdAt.toISOString(), byName: row.actorUserId ? names.get(row.actorUserId) ?? null : null, reason: data.data.reason })
  }
  return result
}

/** Withdraws permission, never deletes a request or rewrites its original
 * approval. An exact retry shares the first audit and employee notification. */
export async function revokeAttendanceLeaveInTransaction(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer, id: string, raw: unknown) {
  const parsed = AttendanceRevocationInputSchema.safeParse(raw)
  if (!parsed.success || !z.string().uuid().safeParse(id).success) throw new AttendanceRequestError("MTM_ATTENDANCE_REVOCATION_INVALID", 400)
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  const { organizationId, userId } = reviewer
  const candidate = await tx.mtmHrmRequest.findFirst({ where: { organizationId, id, attendanceDetails: { not: Prisma.DbNull } }, select: { agentId: true } })
  if (!candidate) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
  await lockAttendanceRequests(tx, { organizationId, agentId: candidate.agentId })
  const access = await requireAttendanceReviewer(tx, reviewer, candidate.agentId, { allowInactive: true })
  const row = await tx.mtmHrmRequest.findFirst({ where: { organizationId, id }, select: attendanceRequestSelect })
  if (!row) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
  const request = attendanceRequestDto(row)
  const { version, reason } = parsed.data
  if (row.status === "CANCELLED") {
    const prior = await tx.mtmAuditLog.findFirst({ where: { organizationId, action: ATTENDANCE_REVOCATION_ACTION, entity: "hrm_request", entityId: id }, select: { actorUserId: true, newData: true } })
    const data = auditSchema.safeParse(prior?.newData)
    if (prior?.actorUserId !== userId || !data.success || data.data.sourceVersion !== version || data.data.reason !== reason) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_ALREADY_DECIDED")
    return { request, idempotent: true }
  }
  if (!canRevokeAttendanceLeave(request)) throw new AttendanceRequestError("MTM_ATTENDANCE_REVOCATION_UNAVAILABLE")
  if (row.updatedAt.toISOString() !== version) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
  const now = new Date()
  const changed = await tx.mtmHrmRequest.updateMany({ where: { organizationId, id, status: "APPROVED", updatedAt: row.updatedAt }, data: { status: "CANCELLED", cancelledAt: now } })
  if (changed.count !== 1) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
  await tx.mtmAuditLog.create({ data: { organizationId, agentId: candidate.agentId, actorUserId: userId, action: ATTENDANCE_REVOCATION_ACTION,
    entity: "hrm_request", entityId: id, metadataKind: "mtm_attendance_request", createdAt: now,
    oldData: { status: "APPROVED" }, newData: { status: "CANCELLED", sourceVersion: version, reason } } })
  const locale = access.locale === "ru" || access.locale === "en" ? access.locale : "az"
  await tx.mtmNotification.create({ data: { organizationId, agentId: candidate.agentId, type: "warning", title: ({ az, ru, en })[locale].mtmAttendance.revocationNotification,
    metadata: { domain: "route", attendanceRequestId: id, status: "CANCELLED" } } })
  const updated = await tx.mtmHrmRequest.findFirst({ where: { organizationId, id }, select: attendanceRequestSelect })
  if (!updated) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
  return { request: attendanceRequestDto(updated), idempotent: false }
}
export async function revokeAttendanceLeave(reviewer: AttendanceReviewer, id: string, raw: unknown) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => revokeAttendanceLeaveInTransaction(tx, reviewer, id, raw), { timeout: 15_000 })
}
