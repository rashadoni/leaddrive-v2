import { NextResponse } from "next/server"
import { z } from "zod"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { addAzOfficialCalendar, AttendanceCalendarError, attendanceCalendarToday, attendanceOfficialCalendarView, dismissAzFoundCalendar } from "@/lib/mtm/attendance-calendar"

const InputSchema = z.object({ year: z.number().int(), fingerprint: z.string().regex(/^[0-9a-f]{24}$/).optional() }).strict()
const DismissSchema = z.object({ year: z.number().int(), fingerprint: z.string().regex(/^[0-9a-f]{24}$/), dismiss: z.literal(true) }).strict()

async function year(auth: { orgId: string; settings: { timezone: string } }, value: unknown) {
  const thisYear = Number((await attendanceCalendarToday(auth.orgId, auth.settings.timezone)).slice(0, 4))
  return typeof value === "number" && [thisYear, thisYear + 1].includes(value) ? value : null
}
const failure = (error: unknown) => {
  if (error instanceof AttendanceCalendarError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
  console.error("[MTM/attendance/calendar/official] write failed", error instanceof Error ? error.name : "unknown")
  return NextResponse.json({ error: "Could not save calendar", code: "MTM_ATTENDANCE_CALENDAR_FAILED" }, { status: 500 })
}
const invalidYear = () => NextResponse.json({ error: "Invalid year", code: "MTM_ATTENDANCE_CALENDAR_INVALID" }, { status: 400 })
const adminOnly = () => NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })

/** Personnel → Settings → Holidays: what is offered for this or next year (decided, found, not yet). */
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") return adminOnly()
  const selected = await year(auth, Number(new URL(req.url).searchParams.get("year")))
  if (selected === null) return invalidYear()
  return NextResponse.json({ success: true, data: await attendanceOfficialCalendarView(auth.orgId, selected) }, { headers: { "Cache-Control": "private, no-store" } })
})

/**
 * "Add Azerbaijan's holidays" for this or next year; with `fingerprint`, the
 * found calendar the admin reviewed. With `dismiss: true`, "wrong, don't add".
 */
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") return adminOnly()
  const body = await req.json().catch(() => null)
  const dismiss = DismissSchema.safeParse(body)
  const parsed = dismiss.success ? null : InputSchema.safeParse(body)
  const selected = await year(auth, dismiss.success ? dismiss.data.year : parsed?.success ? parsed.data.year : null)
  if (selected === null) return invalidYear()
  try {
    if (dismiss.success) {
      await dismissAzFoundCalendar({ organizationId: auth.orgId, year: selected, fingerprint: dismiss.data.fingerprint })
      return NextResponse.json({ success: true, data: { dismissed: true } })
    }
    const data = await addAzOfficialCalendar({ organizationId: auth.orgId, userId: auth.userId, timezone: auth.settings.timezone, year: selected,
      ...(parsed?.success && parsed.data.fingerprint ? { fingerprint: parsed.data.fingerprint } : {}) })
    return NextResponse.json({ success: true, data })
  } catch (error) { return failure(error) }
})
