import { NextRequest, NextResponse } from "next/server"
import { withMtmAttendanceAuth, type AttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceCalendarToday, AttendanceCalendarError, readAttendanceCalendar, saveAttendanceCalendar } from "@/lib/mtm/attendance-calendar"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"

export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  const today = await attendanceCalendarToday(auth.orgId, auth.settings.timezone)
  const params = new URL(req.url).searchParams
  const from = params.get("from") ?? `${today.slice(0, 4)}-01-01`
  const to = params.get("to") ?? `${today.slice(0, 4)}-12-31`
  if (!isDateKey(from) || !isDateKey(to) || to < from || to >= addDateKeyDays(from, 366)) {
    return NextResponse.json({ error: "Invalid calendar range", code: "MTM_ATTENDANCE_CALENDAR_RANGE_INVALID" }, { status: 400 })
  }
  const days = await readAttendanceCalendar(auth.orgId, from, to)
  return NextResponse.json({ success: true, data: { today, days, canManage: auth.role === "admin" || auth.role === "superadmin" } },
    { headers: { "Cache-Control": "private, no-store" } })
})

async function mutate(req: NextRequest, auth: AttendanceAuth, remove: boolean) {
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })
  }
  try {
    const data = await saveAttendanceCalendar({ organizationId: auth.orgId, userId: auth.userId, timezone: auth.settings.timezone,
      value: await req.json().catch(() => null), remove })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof AttendanceCalendarError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/calendar] write failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not save calendar", code: "MTM_ATTENDANCE_CALENDAR_FAILED" }, { status: 500 })
  }
}
export const POST = withMtmAttendanceAuth("write", (req, auth) => mutate(req, auth, false))
export const DELETE = withMtmAttendanceAuth("write", (req, auth) => mutate(req, auth, true))
