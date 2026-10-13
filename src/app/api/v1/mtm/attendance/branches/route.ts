import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { readAttendanceBranches, saveAttendanceBranch } from "@/lib/mtm/attendance-branches-store"
export const GET = withMtmAttendanceAuth("read", async (_req,auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_FORBIDDEN",403)
    return attendanceRequestResponse(await readAttendanceBranches({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req,auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_FORBIDDEN",403)
    const body = await readJsonRequestWithinLimit(req,4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_INVALID",body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await saveAttendanceBranch({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType },body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
