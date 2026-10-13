import { withMobileRls } from "@/lib/with-mobile-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestResponse, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { readOwnAttendanceLocation, recordOwnAttendanceLocationConsent } from "@/lib/mtm/attendance-location-store"
export const GET = withMobileRls(async (_req,auth) => {
  try { return attendanceRequestResponse(await readOwnAttendanceLocation({organizationId:auth.orgId,agentId:auth.agentId,role:auth.role})) }
  catch (error) { return attendanceRequestFailure(error) }
},{requiredCapability:"route-field"})
export const POST = withMobileRls(async (req,auth) => {
  try {
    const body = await readJsonRequestWithinLimit(req,4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_LOCATION_CONSENT_INVALID",body.reason==="too_large"?413:400)
    return attendanceRequestResponse(await recordOwnAttendanceLocationConsent({organizationId:auth.orgId,agentId:auth.agentId,role:auth.role},body.value))
  } catch (error) { return attendanceRequestFailure(error) }
},{requiredCapability:"route-field"})
