import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { attendanceIdentityConflictResponse } from "@/lib/mtm/attendance-identity-error"
import { createAttendanceEmployee } from "@/lib/mtm/attendance-employee-create"

/** Personnel → Employees → "Add employee": a CRM user and their office card. */
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await createAttendanceEmployee({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value), 201)
  } catch (error) {
    return attendanceIdentityConflictResponse(error) ?? attendanceRequestFailure(error)
  }
})
