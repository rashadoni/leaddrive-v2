import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestResponse, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { readAttendanceLocationPolicy, publishAttendanceLocationPolicy } from "@/lib/mtm/attendance-location-store"
export const GET = withMtmAttendanceAuth("read",async (_req,auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED",403)
    return attendanceRequestResponse(await readAttendanceLocationPolicy({organizationId:auth.orgId,userId:auth.userId,principalType:auth.principalType})) }
  catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write",async (req,auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_ADMIN_REQUIRED",403)
    const body = await readJsonRequestWithinLimit(req,100_000)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_LOCATION_POLICY_INVALID",body.reason==="too_large"?413:400)
    return attendanceRequestResponse(await publishAttendanceLocationPolicy({organizationId:auth.orgId,userId:auth.userId,principalType:auth.principalType},body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
