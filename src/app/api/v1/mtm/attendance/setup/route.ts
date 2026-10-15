import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readAttendanceSetup } from "@/lib/mtm/attendance-setup"

/** Personnel → Today → "Set up attendance": what an administrator still has to do. */
export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })
  }
  const steps = await readAttendanceSetup(auth.orgId, auth.settings.timezone)
  return NextResponse.json({ success: true, data: { steps } }, { headers: { "Cache-Control": "private, no-store" } })
})
