import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestLimitError, readAttendanceRequestLimits, saveAttendanceRequestLimits } from "@/lib/mtm/attendance-request-limit-store"
import { NextResponse } from "next/server"

function failure(error: unknown) {
  const code = error instanceof AttendanceRequestLimitError ? error.code : "MTM_ATTENDANCE_REQUEST_LIMITS_FAILED"
  return NextResponse.json({ error: code, code }, { status: error instanceof AttendanceRequestLimitError ? error.status : 500,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
}
export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  try { return attendanceRequestResponse({ ...await readAttendanceRequestLimits(auth.orgId), canManage: auth.principalType === "session" && (auth.role === "admin" || auth.role === "superadmin") }) }
  catch (error) { return failure(error) }
})
export const PUT = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session" || (auth.role !== "admin" && auth.role !== "superadmin")) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
    const body = await readJsonRequestWithinLimit(req, 2048)
    if (!body.ok) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_REQUEST_LIMITS_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await saveAttendanceRequestLimits(auth.orgId, auth.userId, body.value))
  } catch (error) { return failure(error) }
})
