import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import type { AttendanceLocationFinding } from "@/lib/mtm/attendance-location-contract"

export const ATTENDANCE_OUTSIDE_RULE_KEY = "attendanceRejectOutsideBranch"
async function lockRule(tx: Prisma.TransactionClient, organizationId: string, exclusive: boolean) {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  const key = `mtm-attendance-outside-rule:${organizationId}`
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`
}

/** One ordinary admin setting, prepared even before the feature is enabled.
 * It never turns on location collection. Audit and value commit together. */
export async function saveAttendanceOutsideRule(reviewer: AttendanceReviewer, rejectOutside: boolean) {
  if (reviewer.principalType !== "session" || typeof rejectOutside !== "boolean") {
    throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  }
  const { organizationId, userId } = reviewer
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockRule(tx, organizationId, true)
    const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`
      SELECT role,"hiddenModules" FROM users WHERE "organizationId"=${organizationId} AND id=${userId}
      AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user || !["admin", "superadmin"].includes(user.role) || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) {
      throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
    }
    const prior = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_OUTSIDE_RULE_KEY } }, select: { value: true } })
    const previous = prior?.value === true
    if (prior?.value === rejectOutside || (!prior && !rejectOutside)) return { changed: false }
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId, key: ATTENDANCE_OUTSIDE_RULE_KEY } },
      create: { organizationId, key: ATTENDANCE_OUTSIDE_RULE_KEY, value: rejectOutside }, update: { value: rejectOutside } })
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, action: "MTM_ATTENDANCE_OUTSIDE_RULE_CHANGED",
      entity: "settings", entityId: organizationId, metadataKind: "mtm_attendance_outside_rule",
      oldData: { rejectOutside: previous }, newData: { rejectOutside } } })
    return { changed: true }
  }, { timeout: 15000 })
}

/** Runs inside the canonical mark transaction. Only a reliable outside fix
 * can be refused; no consent, missing GPS, uncertain and legacy marks survive. */
export async function enforceAttendanceOutsideRule(tx: Prisma.TransactionClient, organizationId: string, finding: AttendanceLocationFinding) {
  if (finding !== "OUTSIDE") return
  await lockRule(tx, organizationId, false)
  const setting = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_OUTSIDE_RULE_KEY } }, select: { value: true } })
  if (setting?.value === true) throw new AttendanceRequestError("MTM_ATTENDANCE_LOCATION_OUTSIDE_REJECTED", 422)
}
