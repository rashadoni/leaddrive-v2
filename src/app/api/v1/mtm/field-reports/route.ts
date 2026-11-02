import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"
import { resolveReportRange } from "@/lib/mtm/report-period"
import { readReportFilters, reportAgentIds } from "@/lib/mtm/report-filters"
import { computeFieldReport, FIELD_REPORT_TYPES, type FieldReportType } from "@/lib/mtm/field-reports"
import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { protectMtmExcelText } from "@/lib/mtm/excel-contract"
import { reportExportSheets } from "@/lib/mtm/report-export"

const PAGE_SIZE = 50
const MAX_LIMIT = 100
const EXPORT_LIMIT = 5000

/**
 * The manager's reports added on 2026-11-01 (see src/lib/mtm/field-reports.ts).
 * Same contract as /reports and /management-reports: `type`, `period` or
 * `from`/`to`, `teamId`/`regionId`/`agentId`, `page`/`limit`, `format=xlsx`.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const scope = await resolveMtmFieldScope(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: auth.role })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()
  // An agent never sees how he was rated — nowhere (CLAUDE.md, joint visit).
  const seesEvaluations = scope.actor.role !== "AGENT"

  const search = new URL(req.url).searchParams
  const type = search.get("type") as FieldReportType | null
  const exporting = search.get("format") === "xlsx"
  const language = (["az", "ru", "en"] as const).find((item) => item === search.get("lang")) ?? "az"
  const now = new Date()
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const range = resolveReportRange(search, currentDateKey(now, timezone), timezone)
  if ("error" in range) return NextResponse.json({ success: false, error: range.error }, { status: 400 })
  const agentIds = await reportAgentIds(auth.orgId, scope.kind === "agents" ? scope.agentIds : null, readReportFilters(search))
  const input = (pageNumber: number, limit: number) => ({ organizationId: auth.orgId, range, timezone, agentIds, page: pageNumber, limit, language, now })

  try {
    if (!type) {
      const counted = FIELD_REPORT_TYPES.filter((name) => name !== "joint_evaluations" || seesEvaluations)
      const totals = await Promise.all(counted.map(async (name) => [name, (await computeFieldReport(name, input(1, 1))).total] as const))
      return NextResponse.json({ success: true, data: { counts: Object.fromEntries(totals) } })
    }
    if (!(FIELD_REPORT_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: "Unsupported report" }, { status: 404 })
    if (type === "joint_evaluations" && !seesEvaluations) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const pageNumber = exporting ? 1 : Math.max(1, parseInt(search.get("page") || "1"))
    const limit = exporting ? EXPORT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, parseInt(search.get("limit") || String(PAGE_SIZE))))
    const report = await computeFieldReport(type, input(pageNumber, limit))

    if (exporting) {
      const workbook = buildXlsxWorkbook(await reportExportSheets(type, report.summary, report.rows, language, protectMtmExcelText))
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
      return new NextResponse(buffer as unknown as BodyInit, { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDispositionAttachment(`mtm-${type}-${range.fromKey}-${range.toKey}.xlsx`),
        "Cache-Control": "no-store",
      } })
    }
    return NextResponse.json({ success: true, data: {
      summary: report.summary, series: report.series, reportData: report.rows, total: report.total,
      page: pageNumber, limit, from: range.fromKey, to: range.toKey, type,
    } })
  } catch (error) {
    console.error("[MTM/field-reports GET]", error)
    return NextResponse.json({ error: "Failed to build the report" }, { status: 500 })
  }
})
