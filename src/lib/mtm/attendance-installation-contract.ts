import { z } from "zod"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"

const requestId = z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
export const AttendanceInstallationIdSchema = z.string().regex(/^rf-[a-z0-9-]{20,125}$/)
export const AttendanceInstallationRequestSchema = z.object({ requestId }).strict()
export const AttendanceInstallationDecisionSchema = z.object({ requestId, action: z.enum(["APPROVE", "REJECT", "REVOKE"]), reason: z.string().trim().min(3).max(1000) }).strict()
export const AttendanceInstallationQuerySchema = z.object({ status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED", "REVOKED"]).default("PENDING"), employeeId: z.string().max(128).default(""), teamId: z.string().max(128).default(""), cursor: z.string().uuid().optional() }).strict()
export type AttendanceInstallationState = "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED" | "REVOKED"
export type AttendanceInstallationOwn = {
  required: boolean; installationLabel: string; state: AttendanceInstallationState; requestId: string | null; submittedAt: string | null;
  decision: { action: "APPROVE" | "REJECT"; at: string; reason: string } | null;
  revocation: { at: string; reason: string } | null; canRequest: boolean;
}
export type AttendanceInstallationItem = Omit<AttendanceInstallationOwn, "required" | "canRequest"> & {
  id: string; employeeId: string; employeeName: string; teamId: string | null; teamName: string | null; canDecide: boolean; canRevoke: boolean;
}
export type AttendanceInstallationQueue = { items: AttendanceInstallationItem[]; nextCursor: string | null; timezone: string; required: boolean; canConfigure: boolean }
export function attendanceInstallationFailure(code: string, status = 409): never {
  throw new AttendanceRequestError(`MTM_ATTENDANCE_INSTALLATION_${code}`, status)
}
export function parseAttendanceInstallationId(value: unknown): string {
  const parsed = AttendanceInstallationIdSchema.safeParse(value)
  return parsed.success ? parsed.data : attendanceInstallationFailure("APP_REQUIRED", 422)
}
export function attendanceInstallationState(row: { action: string | null; revokedAt: Date | null } | null): AttendanceInstallationState {
  if (!row) return "NOT_REQUESTED"
  if (row.revokedAt) return "REVOKED"
  return row.action === "APPROVE" ? "APPROVED" : row.action === "REJECT" ? "REJECTED" : "PENDING"
}
