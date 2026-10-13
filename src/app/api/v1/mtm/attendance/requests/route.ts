import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { listAttendanceRequestsForReview } from "@/lib/mtm/attendance-request-review"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    return attendanceRequestResponse(await listAttendanceRequestsForReview({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, Object.fromEntries(new URL(req.url).searchParams)))
  } catch (error) { return attendanceRequestFailure(error) }
})
