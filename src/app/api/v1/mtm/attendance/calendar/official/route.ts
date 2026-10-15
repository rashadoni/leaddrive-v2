import { NextResponse } from "next/server"
import { z } from "zod"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { addAzOfficialCalendar, AttendanceCalendarError, attendanceCalendarToday } from "@/lib/mtm/attendance-calendar"

const InputSchema = z.object({ year: z.number().int() }).strict()

/** Personnel → Settings → Holidays → "Add Azerbaijan's holidays" for this or next year. */
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })
  }
  const parsed = InputSchema.safeParse(await req.json().catch(() => null))
  const thisYear = Number((await attendanceCalendarToday(auth.orgId, auth.settings.timezone)).slice(0, 4))
  if (!parsed.success || ![thisYear, thisYear + 1].includes(parsed.data.year)) {
    return NextResponse.json({ error: "Invalid year", code: "MTM_ATTENDANCE_CALENDAR_INVALID" }, { status: 400 })
  }
  try {
    const data = await addAzOfficialCalendar({ organizationId: auth.orgId, userId: auth.userId, timezone: auth.settings.timezone, year: parsed.data.year })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof AttendanceCalendarError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/calendar/official] write failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not save calendar", code: "MTM_ATTENDANCE_CALENDAR_FAILED" }, { status: 500 })
  }
})
