import type { Prisma } from "@prisma/client"
import { isValidTimezone } from "@/lib/timezone"
import { mayUseAttendanceSelf } from "@/lib/mtm/attendance-employee-contract"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { ATTENDANCE_FEATURE_SETTING_KEY, lockAttendanceFeature } from "@/lib/mtm/attendance-feature"
export type AttendanceSelf = { organizationId: string; agentId: string; role: string }

/** Independent of the withdrawn Workforce grant/route switches. Called again inside every write.
 * Every own function — day marks, location consent, phone approval, requests —
 * rides the one Attendance switch, and none is a field agent's. */
export async function requireAttendanceSelf(db: Prisma.TransactionClient, self: AttendanceSelf) {
  const values = await db.mtmSetting.findMany({ where: { organizationId: self.organizationId, key: { in: [ATTENDANCE_FEATURE_SETTING_KEY, "timezone"] } }, select: { key: true, value: true } })
  if (values.find((value) => value.key === ATTENDANCE_FEATURE_SETTING_KEY)?.value !== true) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DISABLED", 404)
  }
  // A field agent is outside HR accounting altogether. 2026-10-14 took its day
  // out — no attendance marks, location consent or phone approval; its "Start
  // day" is the field session, which never asks this. 2026-10-20 took the rest
  // (owner: «у полевого агента всё кадровое убрать совсем»): no own requests —
  // leave, absence, time correction — nor their documents or explanations,
  // whatever «Что может агент» stored for agents before. Those stay with the
  // employees HR keeps, in «Mənim uçotum».
  if (self.role === "AGENT") throw new AttendanceRequestError("MTM_ATTENDANCE_SELF_REQUIRED", 403)
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
  await lockAttendanceFeature(db, self.organizationId)
  await db.$queryRaw`SELECT "id" FROM "mtm_agents" WHERE "organizationId" = ${self.organizationId} AND "id" = ${self.agentId} FOR SHARE`
}

/** Internal legacy-workday hooks already hold the employee/feature locks.
 * True when this card's day marks are outside HR attendance: an excluded
 * employee, or a field agent whose day belongs to the field manager only
 * (owner, 2026-10-14). Affects attendance evidence only — device approval, QR,
 * location and mark checks — never the field workday itself. */
export async function isAttendanceMarkExempt(db: Prisma.TransactionClient, self: Pick<AttendanceSelf, "organizationId" | "agentId">) {
  const agent = await db.mtmAgent.findFirst({ where: { id: self.agentId, organizationId: self.organizationId }, select: { attendanceExcluded: true, role: true } })
  return agent?.attendanceExcluded === true || agent?.role === "AGENT"
}
/** Former name. The non-UTC regression workflow swaps in a historical
 * attendance-location-store.ts (BASELINE_SHA) that still imports it. */
export const isAttendanceEmployeeExcluded = isAttendanceMarkExempt
