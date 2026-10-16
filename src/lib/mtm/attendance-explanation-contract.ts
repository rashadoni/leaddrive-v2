import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"

/**
 * Personnel → explanations (owner, 2026-10-16, approved mockup): «если кто-то
 * опоздал либо не пришёл — запрос на приложение … чтобы дали объяснительную».
 * Only lateness and an absence with no recorded reason need one: leave, sick
 * leave, a business trip or an approved hour off are already explained.
 */
export const ATTENDANCE_EXPLANATION_KINDS = ["LATE", "ABSENT"] as const
export type AttendanceExplanationKind = (typeof ATTENDANCE_EXPLANATION_KINDS)[number]
export const ATTENDANCE_EXPLANATION_STATUSES = ["REQUESTED", "ANSWERED", "ACCEPTED", "REJECTED"] as const
export type AttendanceExplanationStatus = (typeof ATTENDANCE_EXPLANATION_STATUSES)[number]
/** How far back an employee may explain on their own, and HR may ask. */
export const ATTENDANCE_EXPLANATION_LOOKBACK_DAYS = 31

const dateKey = z.string().refine(isDateKey)
const kind = z.enum(ATTENDANCE_EXPLANATION_KINDS)
export const AttendanceExplanationRequestSchema = z.object({
  items: z.array(z.object({ agentId: z.string().min(1).max(64), date: dateKey, kind }).strict()).min(1).max(500),
}).strict()
export const AttendanceExplanationAnswerSchema = z.object({
  date: dateKey, kind, text: z.string().trim().min(3).max(1000),
}).strict()
export const AttendanceExplanationDecisionSchema = z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) }).strict()
export const AttendanceExplanationListSchema = z.object({ from: dateKey, to: dateKey }).strict()
  .refine(range => range.from <= range.to && Date.parse(range.to) - Date.parse(range.from) <= 92 * 86_400_000)

export type AttendanceExplanationDto = {
  id: string; employeeId: string; employeeName: string; date: string; kind: AttendanceExplanationKind; status: AttendanceExplanationStatus
  lateMinutes: number | null; requestedAt: string | null; requestedByName: string | null
  answer: string | null; answeredAt: string | null; decidedAt: string | null; decidedByName: string | null
}
/** A day the employee may still explain: late or absent, nothing written yet. */
export type AttendanceExplanationCandidate = { date: string; kind: AttendanceExplanationKind; lateMinutes: number | null }

/** Shares the attendance HTTP mapping: the code and status reach the client, nothing else. */
export class AttendanceExplanationError extends AttendanceRequestError {}

/**
 * The one reading of «needs an explanation», the same as Today's attention
 * list: a valid start after the allowed lateness, or the report's ABSENT
 * (a working day, employed, no start and no approved reason).
 */
export function attendanceExplanationCandidates(rows: readonly MtmAttendanceReportRow[]): (AttendanceExplanationCandidate & { employeeId: string })[] {
  return rows.flatMap<AttendanceExplanationCandidate & { employeeId: string }>(row => {
    if (row.kind === "ABSENT") return [{ employeeId: row.employeeId, date: row.date, kind: "ABSENT", lateMinutes: null }]
    if (row.factsState === "VALID" && row.startedAt && (row.lateSeconds ?? 0) > 0) {
      return [{ employeeId: row.employeeId, date: row.date, kind: "LATE", lateMinutes: Math.max(1, Math.round(row.lateSeconds! / 60)) }]
    }
    return []
  })
}
