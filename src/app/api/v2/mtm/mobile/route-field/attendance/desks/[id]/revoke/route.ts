import { withMobileRls } from "@/lib/with-mobile-rls"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { revokeOwnAttendanceDesk } from "@/lib/mtm/attendance-desk-screen"

/** The employee takes one of their own workplaces off. */
export const POST = withMobileRls<{ params: Promise<{ id: string }> }>(async (_req, auth, ctx) => {
  try {
    const { id } = await ctx.params
    return attendanceRequestResponse(await revokeOwnAttendanceDesk({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, id))
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
