import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import {
  getIncrementalMonitoringReport,
  type IncrementalReportLocale,
} from "@/lib/social/incremental-monitoring-report"
import { buildIncrementalMonitoringXlsx } from "@/lib/social/social-monitoring-report-export"
import {
  DEFAULT_REPORT_WINDOW_DAYS,
  getSocialMonitoringSettings,
} from "@/lib/social/monitoring-settings"

const querySchema = z.object({
  format: z.enum(["json", "xlsx"]).default("json"),
  locale: z.enum(["az", "en", "ru"]).default("en"),
  days: z.coerce.number().int().min(1).max(31).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  subjectId: z.string().trim().min(1).optional(),
}).refine(value => !value.from || !value.to || value.from < value.to, {
  message: "from must be before to",
})

function reportFileName(subjectName: string | undefined, to: Date) {
  const subject = (subjectName ?? "all")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    || "all"
  return `social-monitoring-${subject}-${to.toISOString().slice(0, 10)}.xlsx`
}

export const GET = withRlsAuth("social", "read", async (request: NextRequest, auth) => {
  const parsed = querySchema.safeParse({
    format: request.nextUrl.searchParams.get("format") ?? undefined,
    locale: request.nextUrl.searchParams.get("locale") ?? undefined,
    days: request.nextUrl.searchParams.get("days") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
    subjectId: request.nextUrl.searchParams.get("subjectId") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report query", details: parsed.error.flatten() }, { status: 400 })
  }

  const settings = await getSocialMonitoringSettings(auth.orgId)
  const days = parsed.data.days ?? settings.schedule.reportWindowDays ?? DEFAULT_REPORT_WINDOW_DAYS
  const to = parsed.data.to ?? new Date()
  const from = parsed.data.from ?? new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  try {
    const report = await getIncrementalMonitoringReport({
      organizationId: auth.orgId,
      subjectId: parsed.data.subjectId,
      from,
      to,
      days,
      locale: parsed.data.locale as IncrementalReportLocale,
    })

    if (parsed.data.format === "xlsx") {
      const file = await buildIncrementalMonitoringXlsx(report)
      return new NextResponse(new Uint8Array(file), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${reportFileName(report.subject?.name, to)}"`,
          "cache-control": "private, no-store",
        },
      })
    }

    return NextResponse.json({ success: true, data: report }, {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    if (error instanceof Error && error.message === "monitoring_subject_not_found") {
      return NextResponse.json({ error: "Monitoring subject not found" }, { status: 404 })
    }
    throw error
  }
})
