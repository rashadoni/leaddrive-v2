import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readAttendanceMonthN1tForm } from "@/lib/mtm/attendance-month-store"
import { AttendanceMonthN1tExportSchema } from "@/lib/mtm/attendance-month-contract"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { contentDispositionAttachment } from "@/lib/export/tabular"

/**
 * The month's N-1t as one file for accounting (owner, 2026-10-20): every frozen N-1t of the month
 * the reader may open — closed in blocks of at most 100 people — as the one form the screen shows,
 * lines numbered 1..N and one set of totals. Stored cells, never rebuilt from today's data.
 */
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_FORBIDDEN", 403)
    const parsed = AttendanceMonthN1tExportSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
    if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_INVALID", 400)
    const { month, locale, format } = parsed.data
    const { table } = await readAttendanceMonthN1tForm({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, { month, locale })
    const bytes = format === "pdf" ? buildAttendancePdf(table) : Buffer.from(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`N-1t-${month}.${format}`), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } })
  } catch (error) {
    return attendanceRequestFailure(error)
  }
})
