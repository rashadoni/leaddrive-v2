import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readAttendanceMonthN1t } from "@/lib/mtm/attendance-month-store"

/**
 * Personnel → Reports → N-1t for one month: the frozen form of a closed month, or what
 * «Bu tabeli bağla» will freeze. A read: closing still goes through POST /months with the
 * exact preview this returns, and only a signed-in person may do either.
 */
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceMonthN1t(
      { organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" },
      Object.fromEntries(req.nextUrl.searchParams),
    ))
  } catch (error) {
    return attendanceRequestFailure(error)
  }
})
