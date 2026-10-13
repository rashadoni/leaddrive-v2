import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceViewSessionError } from "@/lib/mtm/attendance-view-api"
import { mutateAttendanceDelivery } from "@/lib/mtm/attendance-delivery-api"
import { readAttendanceDeliveries } from "@/lib/mtm/attendance-delivery-store"

export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  const denied = attendanceViewSessionError(auth)
  if (denied) return denied
  const data = await readAttendanceDeliveries(auth.orgId, auth.userId)
  return NextResponse.json({ success: true, data: { ...data, timezone: auth.settings.timezone } }, { headers: { "Cache-Control": "private, no-store" } })
})
export const POST = withMtmAttendanceAuth("read", (req, auth) => mutateAttendanceDelivery(req, auth))
