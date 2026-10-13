import { NextResponse } from "next/server"
import { createTranslator } from "next-intl"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceReportAccessError, readMtmAttendanceReport } from "@/lib/mtm/attendance-report-store"
import { AttendanceExportSchema } from "@/lib/mtm/attendance-export-contract"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { AttendanceExportTooLarge, buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { contentDispositionAttachment } from "@/lib/export/tabular"

export const POST = withMtmAttendanceAuth("read", async (req, auth) => {
  const parsed = AttendanceExportSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || Date.parse(parsed.data.snapshot.asOf) > Date.now() + 60_000) {
    return NextResponse.json({ error: "Invalid export", code: "MTM_ATTENDANCE_EXPORT_INVALID" }, { status: 400 })
  }
  const { config, format, locale, snapshot } = parsed.data
  try {
    const report = await readMtmAttendanceReport({ organizationId: auth.orgId, actor: auth.actor, query: snapshot.query, now: new Date(snapshot.asOf) })
    if (report.snapshot.id !== snapshot.id) {
      return NextResponse.json({ error: "Report data changed; refresh before exporting", code: "MTM_ATTENDANCE_EXPORT_CHANGED" }, { status: 409 })
    }
    const messages = (await import(`../../../../../../../messages/${locale}.json`)).default
    const t = createTranslator({ locale, messages, namespace: "mtmAttendance" })
    const table = buildAttendanceTable(report, config, locale, t)
    const bytes = format === "pdf" ? buildAttendancePdf(table) : Buffer.from(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`attendance-${config.filters.from}-${config.filters.to}.${format}`),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } })
  } catch (error) {
    if (error instanceof AttendanceReportAccessError) return NextResponse.json({ error: "Forbidden", code: error.code }, { status: 403 })
    if (error instanceof AttendanceExportTooLarge) return NextResponse.json({ error: "Choose a smaller export period", code: error.code }, { status: 400 })
    console.error("[MTM/attendance/export] failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not export report", code: "MTM_ATTENDANCE_EXPORT_FAILED" }, { status: 500 })
  }
})
