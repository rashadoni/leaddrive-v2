import { z } from "zod"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { cancelOwnAttendanceRequest } from "@/lib/mtm/attendance-request-store"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

export const DELETE = withMobileRls<{ params: Promise<{ id: string }> }>(async (_req, auth, ctx) => {
  try {
    const { id } = await ctx.params
    if (!z.string().uuid().safeParse(id).success) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
    return attendanceRequestResponse(await cancelOwnAttendanceRequest({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, id))
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
