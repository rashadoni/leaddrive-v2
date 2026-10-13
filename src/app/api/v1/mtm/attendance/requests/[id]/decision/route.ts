import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { decideAttendanceRequest } from "@/lib/mtm/attendance-request-decision"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

export const POST = withMtmAttendanceAuth<{ params: Promise<{ id: string }> }>("write", async (req, auth, context) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_INVALID", body.reason === "too_large" ? 413 : 400)
    const { id } = await context.params
    return attendanceRequestResponse(await decideAttendanceRequest({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, id, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
