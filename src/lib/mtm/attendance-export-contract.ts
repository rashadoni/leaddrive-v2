import { z } from "zod"
import { AttendanceReportQuerySchema } from "@/lib/mtm/attendance-query"
import { AttendanceViewConfigSchema } from "@/lib/mtm/attendance-view-contract"
export const AttendanceExportSchema = z.object({
  config: AttendanceViewConfigSchema,
  format: z.enum(["xlsx", "pdf"]),
  locale: z.enum(["az", "ru", "en"]),
  snapshot: z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), asOf: z.string().datetime(), query: AttendanceReportQuerySchema }).strict(),
}).strict().refine((value) => value.config.filters.from === value.snapshot.query.from && value.config.filters.to === value.snapshot.query.to)
