import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { lockAttendanceRequests } from "@/lib/mtm/attendance-self-access"
import { parseAttendanceInstallationId, attendanceInstallationFailure } from "@/lib/mtm/attendance-installation-contract"

export const ATTENDANCE_INSTALLATION_RULE_KEY = "attendanceRequireInstallationApproval"
export async function lockAttendanceInstallationPolicy(tx: Prisma.TransactionClient, organizationId: string, exclusive = false) {
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  const key = `mtm-attendance-installation-policy:${organizationId}`
  if (exclusive) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`
}
export async function readAttendanceInstallationRule(tx: Prisma.TransactionClient, organizationId: string) {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_INSTALLATION_RULE_KEY } }, select: { value: true } })
  return row?.value === true
}
export async function saveAttendanceInstallationRule(reviewer: AttendanceReviewer, required: boolean) {
  if (reviewer.principalType !== "session" || typeof required !== "boolean") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceInstallationPolicy(tx, reviewer.organizationId, true)
    const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`SELECT role,"hiddenModules" FROM users
      WHERE "organizationId"=${reviewer.organizationId} AND id=${reviewer.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
    if (!user || !["admin", "superadmin"].includes(user.role) || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
    const before = await readAttendanceInstallationRule(tx, reviewer.organizationId)
    if (before === required) return { changed: false }
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: ATTENDANCE_INSTALLATION_RULE_KEY } },
      create: { organizationId: reviewer.organizationId, key: ATTENDANCE_INSTALLATION_RULE_KEY, value: required }, update: { value: required } })
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_INSTALLATION_RULE_CHANGED",
      entity: "settings", entityId: reviewer.organizationId, metadataKind: "mtm_attendance_installation", oldData: { required: before }, newData: { required } } })
    return { changed: true }
  }, { timeout: 15000 })
}

/** Called only for a new canonical START/FINISH/return, inside its transaction.
 * A legacy mark without evidence cannot bypass an explicitly enabled rule.
 * Accepted operation replays return before this hook and remain unchanged. */
export async function enforceAttendanceInstallationApproval(tx: Prisma.TransactionClient, scope: { organizationId: string; agentId: string }, rawInstallation: unknown) {
  const feature = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: scope.organizationId, key: "attendanceEnabled" } }, select: { value: true } })
  if (feature?.value !== true) return
  await lockAttendanceRequests(tx, scope)
  await lockAttendanceInstallationPolicy(tx, scope.organizationId)
  if (!await readAttendanceInstallationRule(tx, scope.organizationId)) return
  const installationId = parseAttendanceInstallationId(rawInstallation)
  // The employee lock also serializes every request, decision and revocation.
  const [row] = await tx.$queryRaw<{ approved: boolean }[]>`SELECT (d.action='APPROVE' AND v.id IS NULL) AS approved
    FROM mtm_attendance_installation_requests r
    LEFT JOIN mtm_attendance_installation_decisions d ON d."organizationId"=r."organizationId" AND d."installationRequestId"=r.id
    LEFT JOIN mtm_attendance_installation_revocations v ON v."organizationId"=d."organizationId" AND v."decisionId"=d.id
    WHERE r."organizationId"=${scope.organizationId} AND r."agentId"=${scope.agentId} AND r."installationId"=${installationId}
    ORDER BY r."submittedAt" DESC,r.id DESC LIMIT 1`
  if (row?.approved !== true) attendanceInstallationFailure("APPROVAL_REQUIRED", 422)
}
