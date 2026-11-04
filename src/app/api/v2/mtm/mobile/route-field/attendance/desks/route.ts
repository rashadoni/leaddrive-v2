import { withMobileRls } from "@/lib/with-mobile-rls"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { listOwnAttendanceDesks } from "@/lib/mtm/attendance-desk-screen"

/** The employee's own workplaces (desk screens). */
export const GET = withMobileRls(async (_req, auth) => {
  try { return attendanceRequestResponse(await listOwnAttendanceDesks({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role })) }
  catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
