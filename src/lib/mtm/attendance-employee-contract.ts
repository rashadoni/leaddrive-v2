import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
const id = z.string().trim().min(1).max(191)
const date = z.string().refine(isDateKey)
export const AttendanceEmployeeEnrollmentSchema = z.object({ clientRequestId: z.string().uuid(), userId: id,
  teamId: id.nullable(), hireDate: date, reason: z.string().trim().min(3).max(1000) }).strict()
export const AttendanceEmploymentInputSchema = z.object({ clientRequestId: z.string().uuid(), agentId: id,
  kind: z.enum(["HIRE", "TERMINATION", "REHIRE"]), date, previousEventId: id.nullable(), reason: z.string().trim().min(3).max(1000) }).strict()
export const AttendanceParticipationInputSchema = z.object({ clientRequestId: z.string().uuid(), agentId: id,
  included: z.boolean(), previousEventId: id.nullable() }).strict()
/** Personnel → Employees → card: job title, department (an MTM team) and manager. */
export const ATTENDANCE_EMPLOYEE_POSITION_MAX = 120
export const AttendanceEmployeeCardSchema = z.object({ agentId: id,
  position: z.string().trim().max(ATTENDANCE_EMPLOYEE_POSITION_MAX).transform(value => value || null).nullable(),
  teamId: id.nullable(), newTeamName: z.string().trim().min(1).max(120).optional(), managerId: id.nullable() }).strict()
  .refine(card => !(card.newTeamName && card.teamId), { path: ["teamId"] })
/** Card roles that see the requests of the people under them: a MANAGER through the
 * reporting line (territory-scope.ts), an ADMIN everywhere. A SUPERVISOR is scoped by
 * team, not by managerId, so naming one here would grant nothing. */
export const ATTENDANCE_MANAGER_ROLES = ["ADMIN", "MANAGER"] as const
/** Personnel → Employees → employee page (owner, 2026-10-16): one save for the
 * person and their work. Phone and email are how the person signs in; they are
 * sent only when the page offers them (see `loginEditable`). No password: the
 * person sets their own from a WhatsApp code. */
export const ATTENDANCE_PHONE_PATTERN = /^\+[1-9]\d{6,14}$/
export const AttendanceEmployeeProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** The WhatsApp number the person signs in by (a code comes there); spaces and dashes are dropped. */
  phone: z.string().transform(value => value.replace(/[\s\-()]/g, "")).pipe(z.string().regex(ATTENDANCE_PHONE_PATTERN)).optional(),
  email: z.union([z.literal("").transform(() => null), z.string().trim().toLowerCase().max(320).email(), z.null()]).optional(),
  position: z.string().trim().max(ATTENDANCE_EMPLOYEE_POSITION_MAX).transform(value => value || null).nullable(),
  teamId: id.nullable(), newTeamName: z.string().trim().min(1).max(120).optional(), managerId: id.nullable(),
  /** Only while the employment history is empty: becomes its first HIRE. */
  hireDate: date.nullable().optional(),
}).strict().refine(profile => !(profile.newTeamName && profile.teamId), { path: ["teamId"] })
export type AttendanceEmployeeToday = { status: "STARTED" | "PAUSED" | "COMPLETED"; startedAt: string | null; completedAt: string | null }
export type AttendanceEmploymentHistoryItem = { id: string; kind: "HIRE" | "TERMINATION" | "REHIRE"; date: string; at: string; byName: string | null }
export type AttendanceEmployeeDetail = {
  timezone: string; today: string
  employee: { id: string; name: string; phone: string | null; email: string | null; role: string; status: string; loginEditable: boolean
    /** The CRM role behind the card; Personnel removes only its own office employees. */
    crmRole?: string | null
    position: string | null; teamId: string | null; teamName: string | null; managerId: string | null
    included: boolean; participationVersion: string | null; history: AttendanceEmploymentHistoryItem[]; todayMark: AttendanceEmployeeToday | null }
  teams: Array<{ id: string; name: string }>; managers: Array<{ id: string; name: string; position: string | null }>
  month: { from: string; to: string; workedDays: number; workedSeconds: number; lateCount: number; absentCount: number; leaveDays: number; sickDays: number; isComplete: boolean } | null
}
/** The CRM role Personnel gives an office employee it adds: they see no module
 * (every one hidden) and sign in only to the MTM app. */
export const OFFICE_EMPLOYEE_CRM_ROLE = "viewer"
/** Personnel → employee page → remove (owner, 2026-10-16: «где удаление
 * сотрудников»). The rule the owner set for MTM agents on 2026-10-06: delete
 * only without work history; with history the person is let go instead. */
export const AttendanceEmployeeRemoveSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("DELETE") }).strict(),
  z.object({ mode: z.literal("DISMISS"), lastDay: date, reason: z.string().trim().min(3).max(1000) }).strict(),
])
export type AttendanceParticipationEvent = { id: string; agentId: string; included: boolean; effectiveAt: string }
export type AttendanceEmployeeDirectory = {
  users: Array<{ id: string; name: string; existingRole: string | null; existingTeamId: string | null; eligible: boolean }>
  teams: Array<{ id: string; name: string }>
  managers: Array<{ id: string; name: string; position: string | null }>
  employees: Array<{ id: string; name: string; role: string; teamName: string | null; status: string;
    position: string | null; teamId: string | null; managerId: string | null; phone?: string | null; todayMark?: AttendanceEmployeeToday | null;
    included: boolean; participationVersion: string | null; includedFrom: string | null;
    history: Array<{ id: string; kind: "HIRE" | "TERMINATION" | "REHIRE"; date: string; at: string; byName: string | null }> }>
  timezone: string
}
const SELF_ROLES = new Set(["AGENT", "EMPLOYEE", "ADMIN", "MANAGER", "SUPERVISOR"])
export function mayUseAttendanceSelf(role: string, attendanceEnabled: boolean, participant: boolean, excluded = false) {
  return attendanceEnabled && !excluded && SELF_ROLES.has(role) && (role === "AGENT" || participant)
}
/** Exact allowlist is applied by fresh mobile authentication, including dual
 * web/mobile transports that don't use withMobileRls. Unknown paths deny. */
export function officeAttendanceMobilePath(method: string, path: string) {
  if (method === "POST" && path === "/api/v2/mtm/mobile/route-field/workday-return") return true
  if ((method === "GET" || method === "POST") && ["/api/v2/mtm/mobile/route-field/attendance/location-consent", "/api/v2/mtm/mobile/route-field/attendance/installation"].includes(path)) return true
  if ((method === "POST" || method === "DELETE") && path === "/api/v2/mtm/mobile/route-field/device-tokens") return true
  if (method === "GET" && ["/api/v1/mtm/mobile/bootstrap", "/api/v1/mtm/mobile/ping", "/api/v1/mtm/mobile/profile",
    "/api/v1/mtm/mobile/notifications", "/api/v2/mtm/mobile/route-field/attendance/requests", "/api/v2/mtm/mobile/route-field/attendance/request-limits"].includes(path)) return true
  if (method === "POST" && ["/api/v1/mtm/mobile/sync/push", "/api/v2/mtm/mobile/route-field/attendance/requests", "/api/v2/mtm/mobile/route-field/attendance/attachments"].includes(path)) return true
  if (method === "PATCH" && path === "/api/v1/mtm/mobile/notifications") return true
  // A manager in a Personnel-only tenant reviews his people's requests from
  // the app (2026-10-17). The handlers themselves require TEAM_READ and the
  // browser's review rights, so an employee gets nothing from them.
  if (method === "GET" && path === "/api/v1/mtm/mobile/manager/approvals") return true
  if (method === "POST" && /^\/api\/v1\/mtm\/mobile\/manager\/attendance-requests\/[a-f0-9-]{36}\/decision$/.test(path)) return true
  if (method === "DELETE" && /^\/api\/v2\/mtm\/mobile\/route-field\/attendance\/requests\/[a-f0-9-]{36}$/.test(path)) return true
  return (method === "GET" || method === "DELETE") && /^\/api\/v2\/mtm\/mobile\/route-field\/attendance\/attachments\/[a-f0-9-]{36}$/.test(path)
}
