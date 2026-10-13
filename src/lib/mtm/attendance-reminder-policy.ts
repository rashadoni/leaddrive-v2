import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { ATTENDANCE_REMINDER_KEYS, AttendanceReminderPolicySchema, type AttendanceReminderPolicy } from "@/lib/mtm/attendance-reminder-contract"

export async function lockAttendanceReminderPolicy(tx: Prisma.TransactionClient, organizationId: string, exclusive = false) {
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  const key = `mtm-attendance-reminder-policy:${organizationId}`
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`
}
export async function readAttendanceReminderPolicy(tx: Prisma.TransactionClient, organizationId: string): Promise<AttendanceReminderPolicy> {
  const rows = await tx.mtmSetting.findMany({ where: { organizationId, key: { in: ["attendanceEnabled", ...ATTENDANCE_REMINDER_KEYS] } }, select: { key: true, value: true } })
  const enabled = (key: string) => rows.find(row => row.key === key)?.value === true
  return { enabled: enabled("attendanceEnabled"), employee: enabled(ATTENDANCE_REMINDER_KEYS[0]), manager: enabled(ATTENDANCE_REMINDER_KEYS[1]) }
}
export async function saveAttendanceReminderPolicy(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceReminderPolicySchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_REMINDER_POLICY_INVALID", 400)
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceReminderPolicy(tx, reviewer.organizationId, true)
    const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`SELECT role,"hiddenModules" FROM users
      WHERE "organizationId"=${reviewer.organizationId} AND id=${reviewer.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user || !["admin", "superadmin"].includes(user.role) || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
    const rows = await tx.mtmSetting.findMany({ where: { organizationId: reviewer.organizationId, key: { in: [...ATTENDANCE_REMINDER_KEYS] } }, select: { key: true, value: true } })
    const before: Record<string, boolean> = {}, after: Record<string, boolean> = {}
    for (const key of ATTENDANCE_REMINDER_KEYS) {
      const value = parsed.data[key]
      if (value === undefined) continue
      const previous = rows.find(row => row.key === key)?.value === true
      if (previous === value) continue
      before[key] = previous; after[key] = value
      await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key } },
        create: { organizationId: reviewer.organizationId, key, value }, update: { value } })
    }
    if (!Object.keys(after).length) return { changed: false }
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId,
      action: "MTM_ATTENDANCE_REMINDER_POLICY_CHANGED", entity: "settings", entityId: reviewer.organizationId,
      metadataKind: "mtm_attendance_reminder", oldData: before, newData: after } })
    return { changed: true }
  }, { timeout: 15000 })
}
