import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { readAttendanceBranchScreens, startAttendanceBranchScreenPairing } from "@/lib/mtm/attendance-branch-screen-store"

/** Branches and their paired screens (GET); a one-time pairing code for one branch (POST, administrators). */
export const GET = withMtmAttendanceAuth("write", async (_req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_SCREEN_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceBranchScreens({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_SCREEN_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 512)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_SCREEN_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await startAttendanceBranchScreenPairing({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
