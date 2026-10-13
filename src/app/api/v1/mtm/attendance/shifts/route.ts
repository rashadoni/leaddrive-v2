import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { publishAttendanceShiftPlan, readAttendanceShiftDirectory } from "@/lib/mtm/attendance-shift-store"
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_SHIFT_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceShiftDirectory({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, Object.fromEntries(req.nextUrl.searchParams)))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_SHIFT_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 32768)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_SHIFT_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await publishAttendanceShiftPlan({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
