import type { Prisma } from "@prisma/client"
import { isValidTimezone } from "@/lib/timezone"
import { agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import { mayUseAttendanceSelf } from "@/lib/mtm/attendance-employee-contract"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
export type AttendanceSelf = { organizationId: string; agentId: string; role: string }

/** Independent of the withdrawn Workforce grant/route switches. Called again inside every write. */
export async function requireAttendanceSelf(db: Prisma.TransactionClient, self: AttendanceSelf, permission: "attendanceRequests" | "attendanceWorkday" | "attendanceLocation" | "attendanceInstallation" = "attendanceRequests") {
  const values = await db.mtmSetting.findMany({ where: { organizationId: self.organizationId, key: { in: ["attendanceEnabled", "timezone"] } }, select: { key: true, value: true } })
  if (!agentPermissionEnabled({ attendanceEnabled: values.find((value) => value.key === "attendanceEnabled")?.value === true }, permission)) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DISABLED", 404)
  }
  const agent = await db.mtmAgent.findFirst({ where: { id: self.agentId, organizationId: self.organizationId, status: "ACTIVE", role: self.role as Prisma.MtmAgentWhereInput["role"] }, select: { id: true, role: true, attendanceParticipant: true, attendanceExcluded: true } })
  if (!agent || !mayUseAttendanceSelf(self.role, true, agent.attendanceParticipant === true, agent.attendanceExcluded === true)) throw new AttendanceRequestError("MTM_ATTENDANCE_SELF_REQUIRED", 403)
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

/** Internal legacy-workday hooks already hold the employee/feature locks.
 * Exclusion affects attendance evidence only, never the field workday itself. */
export async function isAttendanceEmployeeExcluded(db: Prisma.TransactionClient, self: Pick<AttendanceSelf, "organizationId" | "agentId">) {
  const agent = await db.mtmAgent.findFirst({ where: { id: self.agentId, organizationId: self.organizationId }, select: { attendanceExcluded: true } })
  return agent?.attendanceExcluded === true
}
