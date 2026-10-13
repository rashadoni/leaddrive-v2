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
export type AttendanceParticipationEvent = { id: string; agentId: string; included: boolean; effectiveAt: string }
export type AttendanceEmployeeDirectory = {
  users: Array<{ id: string; name: string; existingRole: string | null; existingTeamId: string | null; eligible: boolean }>
  teams: Array<{ id: string; name: string }>
  employees: Array<{ id: string; name: string; role: string; teamName: string | null; status: string;
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
  if (method === "DELETE" && /^\/api\/v2\/mtm\/mobile\/route-field\/attendance\/requests\/[a-f0-9-]{36}$/.test(path)) return true
  return (method === "GET" || method === "DELETE") && /^\/api\/v2\/mtm\/mobile\/route-field\/attendance\/attachments\/[a-f0-9-]{36}$/.test(path)
}
