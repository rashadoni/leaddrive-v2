import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { decideAttendanceExplanation } from "@/lib/mtm/attendance-explanation-store"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

type Context = { params: Promise<{ id: string }> }
/** HR accepts an answered explanation or does not. */
export const POST = withMtmAttendanceAuth<Context>("write", async (req, auth, { params }) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const { id } = await params
    return attendanceRequestResponse(await decideAttendanceExplanation({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, id, await req.json().catch(() => null)))
  } catch (error) { return attendanceRequestFailure(error) }
})
