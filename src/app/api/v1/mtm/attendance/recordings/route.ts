import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readAttendanceHrDirectory, recordAttendanceDays } from "@/lib/mtm/attendance-hr-recording"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceHrDirectory({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const result = await recordAttendanceDays({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, await req.json().catch(() => null))
    return attendanceRequestResponse(result, result.idempotent ? 200 : 201)
  } catch (error) { return attendanceRequestFailure(error) }
})
