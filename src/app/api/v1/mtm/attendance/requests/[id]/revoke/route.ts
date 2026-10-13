import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { revokeAttendanceLeave } from "@/lib/mtm/attendance-request-revocation"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

type RevocationContext = { params: Promise<{ id: string }> }
export const POST = withMtmAttendanceAuth<RevocationContext>("write", async (req, auth, context) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_REVOCATION_INVALID", body.reason === "too_large" ? 413 : 400)
    const { id } = await context.params
    return attendanceRequestResponse(await revokeAttendanceLeave({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, id, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
