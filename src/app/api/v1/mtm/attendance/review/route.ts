import { createTranslator } from "next-intl"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { AttendanceRiskExportSchema } from "@/lib/mtm/attendance-risk-contract"
import { readAttendanceRiskReport } from "@/lib/mtm/attendance-risk-review-store"
import { buildAttendanceRiskTable } from "@/lib/mtm/attendance-risk-table"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { contentDispositionAttachment } from "@/lib/export/tabular"
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
    let query = Object.fromEntries(req.nextUrl.searchParams)
    if (Object.keys(query).length === 0) {
      const today = currentDateKey(new Date(), auth.settings.timezone)
      query = { from: `${today.slice(0, 7)}-01`, to: today }
    }
    return attendanceRequestResponse(await readAttendanceRiskReport({ organizationId: auth.orgId, actor: auth.actor,
      allEmployeesGrant: "allEmployeesGrant" in auth && auth.allEmployeesGrant === true,
      reviewer: { organizationId: auth.orgId, userId: auth.userId, principalType: "session" }, query }))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_EXPORT_INVALID", body.reason === "too_large" ? 413 : 400)
    const parsed = AttendanceRiskExportSchema.safeParse(body.value)
    if (!parsed.success || Date.parse(parsed.data.snapshot.asOf) > Date.now() + 60000) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_EXPORT_INVALID", 400)
    const { snapshot, format, locale } = parsed.data
    const report = await readAttendanceRiskReport({ organizationId: auth.orgId, actor: auth.actor,
      allEmployeesGrant: "allEmployeesGrant" in auth && auth.allEmployeesGrant === true,
      reviewer: { organizationId: auth.orgId, userId: auth.userId, principalType: "session" }, query: snapshot.query, now: new Date(snapshot.asOf) })
    if (report.snapshot.id !== snapshot.id) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_CHANGED")
    const messages = (await import(`../../../../../../../messages/${locale}.json`)).default
    const table = buildAttendanceRiskTable(report, locale, createTranslator({ locale, messages, namespace: "mtmAttendance" }))
    const bytes = format === "pdf" ? buildAttendancePdf(table) : Buffer.from(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`attendance-review-${snapshot.query.from}-${snapshot.query.to}.${format}`), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
  } catch (error) { return attendanceRequestFailure(error) }
})
