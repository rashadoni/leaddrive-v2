import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readAttendanceLeaveBalances } from "@/lib/mtm/attendance-leave-store"
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_LEAVE_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceLeaveBalances({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, Object.fromEntries(req.nextUrl.searchParams))) }
  catch (error) { return attendanceRequestFailure(error) }
})
