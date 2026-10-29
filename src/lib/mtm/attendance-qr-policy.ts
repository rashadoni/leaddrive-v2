import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"

export const ATTENDANCE_QR_RULE_KEY = "attendanceBranchQrEnabled"
export async function lockAttendanceQrPolicy(tx: Prisma.TransactionClient, organizationId: string, exclusive = false) {
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  const key = `mtm-attendance-qr-policy:${organizationId}`
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`
}
export async function readAttendanceQrRule(tx: Prisma.TransactionClient, organizationId: string) {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_QR_RULE_KEY } }, select: { value: true } })
  return row?.value === true
}
/** The QR rule and the branch screens are configured by a current administrator only. */
export async function requireAttendanceQrAdmin(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer) {
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`SELECT role,"hiddenModules" FROM users
    WHERE "organizationId"=${reviewer.organizationId} AND id=${reviewer.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || !["admin", "superadmin"].includes(user.role) || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
}
export async function saveAttendanceQrRule(reviewer: AttendanceReviewer, enabled: boolean) {
  if (reviewer.principalType !== "session" || typeof enabled !== "boolean") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceQrPolicy(tx, reviewer.organizationId, true)
    await requireAttendanceQrAdmin(tx, reviewer)
    const before = await readAttendanceQrRule(tx, reviewer.organizationId)
    if (before === enabled) return { changed: false }
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: ATTENDANCE_QR_RULE_KEY } },
      create: { organizationId: reviewer.organizationId, key: ATTENDANCE_QR_RULE_KEY, value: enabled }, update: { value: enabled } })
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_QR_RULE_CHANGED",
      entity: "settings", entityId: reviewer.organizationId, metadataKind: "mtm_attendance_qr", oldData: { enabled: before }, newData: { enabled } } })
    return { changed: true }
  }, { timeout: 15000 })
}

