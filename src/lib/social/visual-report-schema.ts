import { z } from "zod"

export const VISUAL_REPORT_SECTIONS = [
  "summary",
  "kpis",
  "sentiment",
  "platforms",
  "trend",
  "contentTypes",
  "topFindings",
  "comments",
] as const

export type VisualReportSection = typeof VISUAL_REPORT_SECTIONS[number]

export const VISUAL_REPORT_SENTIMENTS = [
  "positive",
  "neutral",
  "negative",
  "unknown",
] as const

export type VisualReportRequestSentiment = typeof VISUAL_REPORT_SENTIMENTS[number]

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, "Invalid calendar date")

export const visualReportRangeSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
}).superRefine((range, context) => {
  const from = Date.parse(`${range.from}T00:00:00.000Z`)
  const to = Date.parse(`${range.to}T00:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return

  if (from > to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "to must be on or after from",
    })
    return
  }

  const inclusiveDays = Math.round((to - from) / 86_400_000) + 1
  if (inclusiveDays > 366) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "Report range cannot exceed 366 days",
    })
  }
})

export const visualReportRequestSchema = z.object({
  format: z.enum(["json", "pdf"]).default("json"),
  locale: z.enum(["az", "ru", "en"]).default("en"),
  subjectIds: z.array(z.string().trim().min(1)).min(1).max(20),
  range: visualReportRangeSchema,
  sections: z.array(z.enum(VISUAL_REPORT_SECTIONS))
    .min(1)
    .max(VISUAL_REPORT_SECTIONS.length)
    .default([...VISUAL_REPORT_SECTIONS]),
  topFindingsLimit: z.number().int().min(1).max(50).default(20),
  commentsLimit: z.number().int().min(1).max(50).default(20),
  // Тональности РАЗДЕЛА НАХОДОК. Портфельные счётчики (KPI, графики) считаются
  // по всем находкам периода: иначе отчёт стал бы внутренне противоречивым —
  // «100% негатива» при выбранном фильтре «только негатив».
  topFindingsSentiments: z.array(z.enum(VISUAL_REPORT_SENTIMENTS))
    .min(1)
    .max(VISUAL_REPORT_SENTIMENTS.length)
    // Умолчание — все тональности: старый закэшированный клиент PWA не должен
    // молча получить урезанный раздел находок.
    .default([...VISUAL_REPORT_SENTIMENTS]),
}).superRefine((request, context) => {
  if (new Set(request.subjectIds).size !== request.subjectIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectIds"],
      message: "subjectIds must be unique",
    })
  }
  if (new Set(request.topFindingsSentiments).size !== request.topFindingsSentiments.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["topFindingsSentiments"],
      message: "topFindingsSentiments must be unique",
    })
  }
  if (new Set(request.sections).size !== request.sections.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sections"],
      message: "sections must be unique",
    })
  }
})

export type VisualReportRequest = z.infer<typeof visualReportRequestSchema>

export function resolveVisualReportRange(range: VisualReportRequest["range"]): {
  from: Date
  toExclusive: Date
  days: number
} {
  const from = new Date(`${range.from}T00:00:00.000Z`)
  const toInclusive = new Date(`${range.to}T00:00:00.000Z`)
  const toExclusive = new Date(toInclusive.getTime() + 86_400_000)
  return {
    from,
    toExclusive,
    days: Math.round((toInclusive.getTime() - from.getTime()) / 86_400_000) + 1,
  }
}
