import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { readAttendanceBranchAssignments, saveAttendancePrimaryBranch } from "@/lib/mtm/attendance-branches-store"
export const GET = withMtmAttendanceAuth("read", async (req,auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_FORBIDDEN",403)
    const search = new URL(req.url).searchParams.get("search")?.trim() ?? ""
    if (search.length > 100) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_INVALID",400)
    return attendanceRequestResponse(await readAttendanceBranchAssignments({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType },auth.actor,search))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req,auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_FORBIDDEN",403)
    const body = await readJsonRequestWithinLimit(req,2048)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_INVALID",body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await saveAttendancePrimaryBranch({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType },body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
