import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { effectiveHiddenModules } from "@/lib/user-module-access"
export const ATTENDANCE_RISK_SETTING_KEYS = ["attendanceAllowSharedInstallations", "attendanceRejectMockLocations", "attendanceClockDifferenceSeconds"] as const
export type AttendanceRiskPolicy = { allowSharedInstallations: boolean; rejectMockLocations: boolean; clockDifferenceSeconds: number }
export const DEFAULT_ATTENDANCE_RISK_POLICY: AttendanceRiskPolicy = { allowSharedInstallations: false, rejectMockLocations: false, clockDifferenceSeconds: 300 }
export async function lockAttendanceRiskPolicy(tx: Prisma.TransactionClient, organizationId: string, exclusive = false) {
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  const key = `mtm-attendance-risk-policy:${organizationId}`
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`
}
export async function readAttendanceRiskPolicy(tx: Prisma.TransactionClient, organizationId: string): Promise<AttendanceRiskPolicy> {
  const rows = await tx.mtmSetting.findMany({ where: { organizationId, key: { in: [...ATTENDANCE_RISK_SETTING_KEYS] } }, select: { key: true, value: true } })
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
  const threshold = values.attendanceClockDifferenceSeconds
  return { allowSharedInstallations: values.attendanceAllowSharedInstallations === true, rejectMockLocations: values.attendanceRejectMockLocations === true,
    clockDifferenceSeconds: typeof threshold === "number" && Number.isInteger(threshold) && threshold >= 30 && threshold <= 86400 ? threshold : 300 }
}
/** The policy may be prepared before attendance is enabled. This does not
 * enable tracking. All changed risk values and their audit commit together. */
export async function saveAttendanceRiskPolicy(reviewer: AttendanceReviewer, changes: Record<string, unknown>) {
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  const entries = Object.entries(changes)
  for (const [key, value] of entries) {
    if (!(ATTENDANCE_RISK_SETTING_KEYS as readonly string[]).includes(key)
      || (key === "attendanceClockDifferenceSeconds" ? typeof value !== "number" || !Number.isInteger(value) || value < 30 || value > 86400 : typeof value !== "boolean")) {
      throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_POLICY_INVALID", 400)
    }
  }
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceRiskPolicy(tx, reviewer.organizationId, true)
    const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`SELECT role,"hiddenModules" FROM users
      WHERE "organizationId"=${reviewer.organizationId} AND id=${reviewer.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user || !["admin", "superadmin"].includes(user.role) || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
    const prior = await readAttendanceRiskPolicy(tx, reviewer.organizationId)
    for (const [key, value] of entries) await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key } },
      create: { organizationId: reviewer.organizationId, key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } })
    const next = await readAttendanceRiskPolicy(tx, reviewer.organizationId)
    if (JSON.stringify(prior) !== JSON.stringify(next)) await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId,
      action: "MTM_ATTENDANCE_RISK_POLICY_CHANGED", entity: "settings", entityId: reviewer.organizationId, metadataKind: "mtm_attendance_risk_policy", oldData: prior, newData: next } })
    return next
  }, { timeout: 15000 })
}
