import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { clientIp } from "@/lib/request-ip"
import { saveAttendanceBranchNetwork } from "@/lib/mtm/attendance-desk-screen"

/** «Запомнить сеть этого компьютера» / «Забыть сеть» for one branch (administrators): the address is the server's view of this browser, never typed. */
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DESK_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 256)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_DESK_INVALID", body.reason === "too_large" ? 413 : 400)
    const ip = clientIp(req)
    return attendanceRequestResponse(await saveAttendanceBranchNetwork({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value, ip === "unknown" ? null : ip))
  } catch (error) { return attendanceRequestFailure(error) }
})
