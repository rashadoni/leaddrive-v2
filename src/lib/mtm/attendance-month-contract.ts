import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
import type { AttendanceTable } from "@/lib/mtm/attendance-table"
const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
const agent = z.string().min(1).max(191)
export const AttendanceMonthQuerySchema = z.object({ month, offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict()
export const AttendanceMonthSelectionSchema = z.object({ month, agentIds: z.array(agent).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).strict()
export const AttendanceMonthCloseSchema = AttendanceMonthSelectionSchema.extend({ requestId: z.string().uuid(), preview: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), asOf: z.string().datetime() }).strict() }).strict()
export const AttendanceMonthExportSchema = z.object({ locale: z.enum(["az", "ru", "en"]), format: z.enum(["xlsx", "pdf"]) }).strict()
export const AttendanceMonthTableSchema = z.object({ title: z.string().max(500), columns: z.array(z.object({ key: z.string().max(100), label: z.string().max(500) }).strict()).min(1).max(50),
  rows: z.array(z.object({ key: z.string().max(200), cells: z.array(z.union([z.string().max(5000),z.number().finite()])).max(50), kind: z.enum(["NOT_EMPLOYED","APPROVED_REQUEST","WORKED","OPEN","MISSING_FINISH","ABSENT","WEEKEND","HOLIDAY","UPCOMING","INVALID_FACTS"]).optional() }).strict()).max(100),
  // A month of 100 people carries a line per approved request day and per correction: far more than 100.
  // The payload's byte limit (attendance-month-snapshot.ts) bounds the whole.
  details: z.array(z.string().max(10000)).max(20000), totals: z.array(z.string().max(10000)).max(100),
}).strict().refine(table => table.rows.every(row => row.cells.length === table.columns.length))
const AttendanceMonthTablesSchema = z.object({ az: AttendanceMonthTableSchema, ru: AttendanceMonthTableSchema, en: AttendanceMonthTableSchema }).strict()
export const AttendanceMonthPayloadSchema = z.object({ version: z.literal(1), month, from: z.string().refine(isDateKey), to: z.string().refine(isDateKey), asOf: z.string().datetime(),
  agentIds: z.array(agent).min(1).max(100),
  coverage: z.array(z.object({ agentId: agent, sourceDate: z.string().refine(isDateKey), accountingDate: z.string().refine(isDateKey), workdayId: z.string().max(191).nullable(), correctionIds: z.array(z.string().max(191)).max(1000) }).strict()).min(1).max(3200),
  tables: AttendanceMonthTablesSchema,
  // «Forma N-1t» as Personnel → Reports → N-1t computes it at close time (owner, 2026-10-20: the
  // closed month is the accounting form). Months closed before it carry only the month grid.
  n1t: AttendanceMonthTablesSchema.optional(),
}).strict()
export type AttendanceMonthSelection = z.infer<typeof AttendanceMonthSelectionSchema>
export type AttendanceMonthPayload = z.infer<typeof AttendanceMonthPayloadSchema>
/** N1T: the frozen accounting form; MONTH: a month closed before the form was frozen keeps its month grid. */
export type AttendanceMonthForm = "N1T" | "MONTH"
export type AttendanceMonthPreview = { month: string; agentIds: string[]; hash: string; asOf: string; form: AttendanceMonthForm; table: AttendanceTable; blockers: { employeeId: string; date: string; kind: string }[] }
export type AttendanceMonthSummary = { id: string; month: string; createdAt: string; createdByName: string | null; employeeCount: number }
export type AttendanceMonthCorrection = { id: string; employeeId: string; employeeName: string; date: string; at: string; reviewerName: string | null; requestId: string | null; before: { startedAt: string; completedAt: string | null } | null; after: { startedAt: string; completedAt: string | null } }
export type AttendanceMonthDetail = AttendanceMonthSummary & { form: AttendanceMonthForm; agentIds: string[]; table: AttendanceTable; corrections: AttendanceMonthCorrection[]; moreCorrections: boolean }
export const AttendanceMonthN1tQuerySchema = z.object({ month, locale: z.enum(["az", "ru", "en"]).default("az") }).strict()
export type AttendanceMonthBlocker = { employeeId: string; employeeName: string; date: string; kind: string }
/** One close the N-1t screen sends: at most 100 people, the exact preview the screen shows. */
export type AttendanceMonthCandidate = { agentIds: string[]; hash: string; asOf: string; table: AttendanceTable }
/**
 * Personnel → Reports → N-1t for one month (owner, 2026-10-20: the screen the clip shows).
 * `closes` are the frozen N-1t the viewer may open whole; `open` counts people in the viewer's
 * scope whose month nobody closed; `candidates` are what «Bu tabeli bağla» freezes in one press
 * (empty while the month runs, without the right to close, or with nobody left to close).
 */
export type AttendanceMonthN1tState = {
  month: string; finished: boolean; canClose: boolean
  closes: AttendanceMonthDetail[]; moreCloses: boolean; closedElsewhere: number
  open: number; ownOpen: boolean; notIncluded: number
  candidates: AttendanceMonthCandidate[]; blockers: AttendanceMonthBlocker[]; moreBlockers: number
}
export type AttendanceMonthDirectory = { month: string; canClose: boolean; employees: { id: string; name: string; teamName: string | null; canClose: boolean; closed: boolean; own?: boolean }[]; moreEmployees: boolean; items: AttendanceMonthSummary[]; moreSnapshots: boolean }
