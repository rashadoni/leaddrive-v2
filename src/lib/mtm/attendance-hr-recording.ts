import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { canReviewMtmRouteRequest } from "@/lib/mtm/route-permissions"
import { resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { attendanceRequestDto, attendanceRequestSelect, lockAttendanceRequests } from "@/lib/mtm/attendance-request-store"
import { AttendanceRequestDetailsSchema, AttendanceRequestError, attendanceRequestWindowsOverlap, type AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"
import { readAttendanceDayKinds } from "@/lib/mtm/attendance-day-kind-store"
import { AttendanceHrRecordingInputSchema, canRecordAttendanceDayKind, type AttendanceHrDirectory } from "@/lib/mtm/attendance-hr-recording-contract"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

async function recordingTimezone(tx: Prisma.TransactionClient, organizationId: string) {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "timezone" } }, select: { value: true } })
  const value = row?.value ?? "Asia/Baku"
  if (typeof value !== "string" || !isValidTimezone(value)) throw new AttendanceRequestError("MTM_ATTENDANCE_TIMEZONE_INVALID")
  return value
}
export async function readAttendanceHrDirectory(reviewer: AttendanceReviewer): Promise<AttendanceHrDirectory> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await resolveAttendanceReviewerScope(tx, reviewer)
    const employees = await tx.mtmAgent.findMany({ where: { organizationId: reviewer.organizationId, status: "ACTIVE",
      ...(actor.scopedAgentIds === null ? {} : { id: { in: actor.scopedAgentIds } }),
      ...(actor.agentId ? { NOT: { id: actor.agentId } } : {}), OR: [{ userId: null }, { userId: { not: reviewer.userId } }],
    }, select: { id: true, name: true, teamId: true, team: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 2001 })
    if (employees.length > 2000) throw new AttendanceRequestError("MTM_ATTENDANCE_HR_DIRECTORY_TOO_LARGE", 422)
    const catalogue = await readAttendanceDayKinds(reviewer.organizationId, tx)
    return { employees: employees.map(employee => ({ id: employee.id, name: employee.name, teamId: employee.teamId, teamName: employee.team?.name ?? null })),
      catalogue: { ...catalogue, items: catalogue.items.filter(canRecordAttendanceDayKind) }, timezone: await recordingTimezone(tx, reviewer.organizationId) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}

/** An explicit, immutable employee list binds a bulk operation. All rows, audit
 * and employee inbox messages commit together; a retry never expands a team. */
export async function recordAttendanceDaysInTransaction(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceHrRecordingInputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_HR_RECORD_INVALID", 400)
  const input = { ...parsed.data, agentIds: [...parsed.data.agentIds].sort() }
  const { organizationId, userId } = reviewer
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-hr-record:${organizationId}:${input.clientRequestId}`}, 0))`
  await resolveAttendanceReviewerScope(tx, reviewer)
  for (const agentId of input.agentIds) await lockAttendanceRequests(tx, { organizationId, agentId })
  const actor = await resolveAttendanceReviewerScope(tx, reviewer)
  // Read after all locks; a deactivation before its lock must invalidate the batch.
  const targets = await tx.mtmAgent.findMany({ where: { organizationId, id: { in: input.agentIds }, status: "ACTIVE" },
    select: { id: true, userId: true, user: { select: { preferredLanguage: true } } } })
  if (targets.length !== input.agentIds.length || targets.some(target => target.userId === userId || !canReviewMtmRouteRequest(actor, target.id))) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  }
  const hash = createHash("sha256").update(JSON.stringify({ ...input, actorUserId: userId })).digest("hex")
  const existing = await tx.mtmHrmRequest.findMany({ where: { organizationId, clientRequestId: input.clientRequestId }, select: attendanceRequestSelect, take: 101 })
  if (existing.length) {
    if (existing.length !== input.agentIds.length || existing.some(row => {
      const details = AttendanceRequestDetailsSchema.safeParse(row.attendanceDetails)
      return !input.agentIds.includes(row.agentId) || !details.success || details.data.kind !== "HR_RECORD" || details.data.submissionHash !== hash
    })) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_IDEMPOTENCY_MISMATCH")
    return { items: existing.map(attendanceRequestDto), idempotent: true }
  }
  const catalogue = await readAttendanceDayKinds(organizationId, tx)
  if (catalogue.version !== input.catalogueVersion) throw new AttendanceRequestError("MTM_ATTENDANCE_DAY_KINDS_CHANGED")
  const dayKind = catalogue.items.find(item => item.key === input.dayKindKey && canRecordAttendanceDayKind(item))
  if (!dayKind || dayKind.unit !== input.unit) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_KIND_UNAVAILABLE", 400)
  const timezone = await recordingTimezone(tx, organizationId)
  if (input.unit === "HOURS") {
    try {
      localDateTimeToUnambiguousUtc(`${input.startDate}T${input.startTime}`, timezone)
      localDateTimeToUnambiguousUtc(`${input.endDate}T${input.endTime}`, timezone)
    } catch { throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_LOCAL_TIME_INVALID", 400) }
  }
  const startDate = new Date(`${input.startDate}T00:00:00Z`), endDate = new Date(`${input.endDate}T00:00:00Z`)
  const overlaps = await tx.mtmHrmRequest.findMany({ where: { organizationId, agentId: { in: input.agentIds }, status: { in: ["PENDING", "APPROVED"] },
    type: { in: ["LEAVE", "ABSENCE"] }, startDate: { lte: endDate }, endDate: { gte: startDate } }, select: { startDate: true, endDate: true, attendanceDetails: true }, take: 10_001 })
  if (overlaps.length > 10_000) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_TOO_MANY")
  for (const row of overlaps) {
    const details = row.attendanceDetails === null ? null : AttendanceRequestDetailsSchema.parse(row.attendanceDetails)
    if (attendanceRequestWindowsOverlap(input, { startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10),
      unit: details?.unit ?? "DAYS", startTime: details?.startTime, endTime: details?.endTime })) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_OVERLAP")
  }
  const now = new Date(), items: AttendanceRequestDto[] = []
  for (const target of targets) {
    const created = await tx.mtmHrmRequest.create({ data: { id: randomUUID(), organizationId, agentId: target.id, clientRequestId: input.clientRequestId,
      type: dayKind.key === "ANNUAL_LEAVE" ? "LEAVE" : "ABSENCE", status: "APPROVED", startDate, endDate, reason: input.reason,
      submittedAt: now, decidedAt: now, decidedByUserId: userId, decisionNote: null,
      attendanceDetails: { version: 1, kind: "HR_RECORD", unit: input.unit, startTime: input.startTime ?? null, endTime: input.endTime ?? null,
        timezone, dayKind, attachmentIds: [], submissionHash: hash, recording: { userId, operationId: input.clientRequestId } },
    }, select: attendanceRequestSelect })
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, agentId: target.id,
      action: "MTM_ATTENDANCE_HR_RECORDED", entity: "hrm_request", entityId: created.id, metadataKind: "mtm_attendance_request",
      newData: { status: "APPROVED", dayKindKey: dayKind.key, operationId: input.clientRequestId, startDate: input.startDate, endDate: input.endDate } } })
    const locale = target.user?.preferredLanguage === "ru" || target.user?.preferredLanguage === "en" ? target.user.preferredLanguage : "az"
    await tx.mtmNotification.create({ data: { organizationId, agentId: target.id, title: ({ az, ru, en })[locale].mtmAttendance.hrRecordingNotification,
      type: "info", metadata: { domain: "route", attendanceRequestId: created.id, status: "APPROVED" } } })
    items.push(attendanceRequestDto(created))
  }
  return { items, idempotent: false }
}
export async function recordAttendanceDays(reviewer: AttendanceReviewer, raw: unknown) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => recordAttendanceDaysInTransaction(tx, reviewer, raw), { timeout: 30_000 })
}
