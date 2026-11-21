import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readAttendancePolicy, saveAttendancePolicy } from "@/lib/mtm/attendance-policy-save"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const refuse = () => new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)

/** Personnel → Settings: reminders, approval and checks, for whoever runs the section. */
export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  try {
    if (auth.principalType !== "session" || !auth.canManagePersonnel) throw refuse()
    return attendanceRequestResponse(await readAttendancePolicy(auth.orgId))
  } catch (error) { return attendanceRequestFailure(error) }
})

export const PUT = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session" || !auth.canManagePersonnel) throw refuse()
    const body = await readJsonRequestWithinLimit(req, 16_384)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_POLICY_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await saveAttendancePolicy(auth, body.value, req))
  } catch (error) { return attendanceRequestFailure(error) }
})
