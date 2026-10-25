import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readAttendancePhoneMatch } from "@/lib/mtm/attendance-phone-match"

// POST keeps a private phone out of URLs, browser history and access-log paths.
// This endpoint only reads; a match cannot create/link a person or change access.
export const POST = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    const body = await readJsonRequestWithinLimit(req, 1024)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await readAttendancePhoneMatch({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
