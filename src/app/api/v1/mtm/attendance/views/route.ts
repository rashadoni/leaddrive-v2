import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceViewSessionError, mutateAttendanceView } from "@/lib/mtm/attendance-view-api"
import { readAttendanceViews } from "@/lib/mtm/attendance-view-store"

export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  const denied = attendanceViewSessionError(auth)
  if (denied) return denied
  const data = await readAttendanceViews(auth.orgId, auth.userId)
  return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } })
})
// Saving one's own display preferences needs report read access, not rule editing.
export const POST = withMtmAttendanceAuth("read", (req, auth) => mutateAttendanceView(req, auth))
