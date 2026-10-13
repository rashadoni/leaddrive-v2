import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { saveAttendanceLeavePolicy } from "@/lib/mtm/attendance-leave-store"
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_LEAVE_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 65536)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_LEAVE_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await saveAttendanceLeavePolicy({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
