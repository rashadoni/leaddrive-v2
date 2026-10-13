import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { setAttendanceParticipation } from "@/lib/mtm/attendance-employee-store"

export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_PARTICIPATION_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await setAttendanceParticipation({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
