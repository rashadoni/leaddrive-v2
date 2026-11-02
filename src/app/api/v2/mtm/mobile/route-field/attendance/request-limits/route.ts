import { withMobileRls } from "@/lib/with-mobile-rls"
import { readOwnAttendanceRequestQuota } from "@/lib/mtm/attendance-request-store"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

export const GET = withMobileRls(async (req, auth) => {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? ""
    return attendanceRequestResponse(await readOwnAttendanceRequestQuota({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, month))
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
