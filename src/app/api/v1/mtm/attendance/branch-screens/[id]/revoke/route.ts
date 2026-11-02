import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { revokeAttendanceBranchScreen } from "@/lib/mtm/attendance-branch-screen-store"

/** «Отключить»: the screen stops showing codes on its next request. */
export const POST = withMtmAttendanceAuth<{ params: Promise<{ id: string }> }>("write", async (_req, auth, ctx) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_SCREEN_FORBIDDEN", 403)
    const { id } = await ctx.params
    return attendanceRequestResponse(await revokeAttendanceBranchScreen({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, id))
  } catch (error) { return attendanceRequestFailure(error) }
})
