import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readAttendanceQrDirectory } from "@/lib/mtm/attendance-qr-store"

export const GET = withMtmAttendanceAuth("write", async (_req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_QR_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceQrDirectory({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }))
  } catch (error) { return attendanceRequestFailure(error) }
})
/**
 * A signed-in browser no longer gets a branch QR (owner, 2026-10-29): opened
 * on any computer, it confirmed a branch the phone was nowhere near. Only a
 * screen paired to the branch shows one — /api/v1/public/attendance-screen/qr.
 */
export const POST = withMtmAttendanceAuth("write", async () =>
  NextResponse.json({ success: false, error: "Branch QR is shown only on a paired branch screen", code: "MTM_ATTENDANCE_QR_SCREEN_ONLY" }, { status: 410 }))
