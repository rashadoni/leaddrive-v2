import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { procurementReport, reportPeriod } from "@/lib/procurement/reports"
import { reportLang, reportPdf, reportSheets } from "@/lib/procurement/report-files"
import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { badRequest } from "@/lib/procurement/access"

/** The purchasing report as Excel (`format=xlsx`, default) or PDF (`format=pdf`), task 7.2. */
export const GET = withRlsAuth("procurement-costs", "export", async (req, { orgId }) => {
  const params = new URL(req.url).searchParams
  const period = reportPeriod(params)
  if (!period) return badRequest("Invalid period", "INVALID_PERIOD")
  const lang = reportLang(params.get("lang"))
  const report = await procurementReport(orgId, period.from, period.to)
  const stamp = `${report.period.from.slice(0, 10)}_${report.period.to.slice(0, 10)}`
  if (params.get("format") === "pdf") {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } })
    const pdf = reportPdf(report, lang, org?.name ?? "")
    return new NextResponse(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDispositionAttachment(`procurement-${stamp}.pdf`), "Cache-Control": "private, no-store" },
    })
  }
  const buffer = await buildXlsxWorkbook(reportSheets(report, lang)).xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`procurement-${stamp}.xlsx`),
      "Cache-Control": "private, no-store",
    },
  })
})
