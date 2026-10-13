import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceReportAccessError, AttendanceReportQuerySchema, readMtmAttendanceReport } from "@/lib/mtm/attendance-report-store"

export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  const parsed = AttendanceReportQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: "Invalid report filters", code: "MTM_ATTENDANCE_REPORT_FILTERS_INVALID" }, { status: 400 })
  try {
    const data = await readMtmAttendanceReport({ organizationId: auth.orgId, actor: auth.actor, query: parsed.data })
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof AttendanceReportAccessError) return NextResponse.json({ error: "Forbidden", code: error.code }, { status: 403 })
    if (error instanceof Error && error.message === "MTM_ATTENDANCE_REPORT_TOO_LARGE") {
      return NextResponse.json({ error: "Choose a smaller report range or team", code: error.message }, { status: 400 })
    }
    console.error("[MTM/attendance/report] read failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not load report", code: "MTM_ATTENDANCE_REPORT_FAILED" }, { status: 500 })
  }
})
