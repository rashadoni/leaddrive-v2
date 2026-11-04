import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { saveAttendanceBranchMarkMethod } from "@/lib/mtm/attendance-branch-mark-method"

/** One branch: «QR + GPS» or «GPS only» (administrators; `attendance-branch-mark-method.ts`). */
export const PUT = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_METHOD_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 512)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_METHOD_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await saveAttendanceBranchMarkMethod({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
