import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { dismissAttendanceRisk } from "@/lib/mtm/attendance-risk-review-store"
export const POST = withMtmAttendanceAuth<{ params: Promise<{ id: string }> }>("write", async (req, auth, context) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 8192)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_DECISION_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await dismissAttendanceRisk({ organizationId: auth.orgId, userId: auth.userId, principalType: "session" }, (await context.params).id, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
