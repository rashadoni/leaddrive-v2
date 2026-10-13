import type { Prisma } from "@prisma/client"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceRequestDetailsSchema, AttendanceRequestError, type AttendanceRequestInput } from "@/lib/mtm/attendance-request-contract"
import { localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { attendanceRequestLimitDecision, isAttendanceRequestLimited } from "@/lib/mtm/attendance-request-limits"
import { lockAttendanceRequestLimits, readAttendanceRequestLimits } from "@/lib/mtm/attendance-request-limit-store"
import type { AttendanceSelf } from "@/lib/mtm/attendance-request-store"

function elapsedMinutes(date: string, startTime: string | null | undefined, endTime: string | null | undefined, timezone: string): number {
  try {
    if (!startTime || !endTime) throw new Error("missing interval")
    const start = localDateTimeToUnambiguousUtc(`${date}T${startTime}`, timezone)
    const end = localDateTimeToUnambiguousUtc(`${date}T${endTime}`, timezone)
    const minutes = (end.getTime() - start.getTime()) / 60_000
    if (!Number.isSafeInteger(minutes) || minutes <= 0) throw new Error("invalid interval")
    return minutes
  } catch { throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_QUOTA_UNAVAILABLE") }
}
export async function attendanceRequestQuotaUsage(db: Prisma.TransactionClient, self: Pick<AttendanceSelf, "organizationId" | "agentId">, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDateKey(`${month}-01`)) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_MONTH_INVALID", 400)
  const start = new Date(`${month}-01T00:00:00Z`)
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1)
  const rows = await db.mtmHrmRequest.findMany({ where: {
    organizationId: self.organizationId, agentId: self.agentId, status: { in: ["PENDING", "APPROVED"] },
    startDate: { gte: start, lt: end },
    OR: [{ attendanceDetails: { path: ["kind"], equals: "HOURLY_ABSENCE" } }, { attendanceDetails: { path: ["kind"], equals: "TIME_OFF" } }],
  }, select: { attendanceDetails: true, startDate: true }, take: 10_001 })
  if (rows.length > 10_000) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_TOO_MANY")
  let usedMinutes = 0, usedRequests = 0
  for (const row of rows) {
    const parsed = AttendanceRequestDetailsSchema.safeParse(row.attendanceDetails)
    if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_QUOTA_UNAVAILABLE")
    const details = parsed.data
    if (!isAttendanceRequestLimited(details)) continue
    const minutes = elapsedMinutes(row.startDate.toISOString().slice(0, 10), details.startTime, details.endTime, details.timezone)
    usedMinutes += minutes; usedRequests += 1
  }
  return { usedMinutes, usedRequests }
}
/** Caller already holds the employee request lock and has checked UUID replay. */
export async function assertAttendanceRequestQuota(db: Prisma.TransactionClient, self: AttendanceSelf, input: AttendanceRequestInput, timezone: string) {
  if (!isAttendanceRequestLimited(input)) return
  await lockAttendanceRequestLimits(db, self.organizationId, "read")
  const limits = await readAttendanceRequestLimits(self.organizationId, db)
  const usage = await attendanceRequestQuotaUsage(db, self, input.startDate.slice(0, 7))
  const code = attendanceRequestLimitDecision(limits, usage, elapsedMinutes(input.startDate, input.startTime, input.endTime, timezone))
  if (code) throw new AttendanceRequestError(code)
}
