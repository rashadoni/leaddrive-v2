import { z } from "zod"
import type { AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"

export const AttendanceRevocationInputSchema = z.object({ version: z.string().datetime(), reason: z.string().trim().min(3).max(1000) }).strict()
export type AttendanceRevocation = { at: string; byName: string | null; reason: string }
export function canRevokeAttendanceLeave(request: Pick<AttendanceRequestDto, "status" | "details">) {
  return request.status === "APPROVED" && request.details.unit === "DAYS" && request.details.dayKind.key === "ANNUAL_LEAVE"
    && (request.details.kind === "ANNUAL_LEAVE" || request.details.kind === "HR_RECORD")
}
