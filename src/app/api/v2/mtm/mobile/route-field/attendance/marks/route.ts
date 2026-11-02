import { withMobileRls } from "@/lib/with-mobile-rls"
import { readOwnAttendanceMarks } from "@/lib/mtm/attendance-own-marks"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"

export const GET = withMobileRls(async (req, auth) => {
  try {
    const query = new URL(req.url).searchParams
    if ([...query.keys()].some(key => key !== "workdayId") || query.getAll("workdayId").length !== 1) throw new AttendanceRequestError("MTM_ATTENDANCE_MARKS_QUERY_INVALID", 400)
    return attendanceRequestResponse(await readOwnAttendanceMarks({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, query.get("workdayId") ?? ""))
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
