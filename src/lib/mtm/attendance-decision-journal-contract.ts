import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"

export const ATTENDANCE_DECISION_JOURNAL_LIMIT = 10_000
export const AttendanceDecisionJournalQuerySchema = z.object({
  from: z.string().refine(isDateKey), to: z.string().refine(isDateKey),
  status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]).default("ALL"),
}).strict().refine(query => query.to >= query.from && (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 < 366)
export type AttendanceDecisionJournalQuery = z.infer<typeof AttendanceDecisionJournalQuerySchema>
export type AttendanceDecisionJournalItem = {
  id: string; employeeId: string; employeeName: string; teamName: string | null
  kind: { key: string; code: string; names: { az: string; ru: string; en: string } }
  requestKind: string; unit: "DAYS" | "HOURS"; startDate: string; endDate: string; startTime: string | null; endTime: string | null; timezone: string
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
  source: "EMPLOYEE" | "HR"; submittedAt: string; submittedByName: string | null
  decision: { at: string; byName: string | null } | null
  cancellation: { at: string; byName: string | null } | null
}
export const AttendanceDecisionJournalSnapshotSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), asOf: z.string().datetime(), query: AttendanceDecisionJournalQuerySchema }).strict()
export type AttendanceDecisionJournal = { items: AttendanceDecisionJournalItem[]; snapshot: z.infer<typeof AttendanceDecisionJournalSnapshotSchema> }
export const AttendanceDecisionJournalExportSchema = z.object({
  snapshot: AttendanceDecisionJournalSnapshotSchema, format: z.enum(["xlsx", "pdf"]), locale: z.enum(["az", "ru", "en"]),
}).strict()
