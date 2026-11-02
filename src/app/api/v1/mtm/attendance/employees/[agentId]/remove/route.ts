import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { removeAttendanceEmployee } from "@/lib/mtm/attendance-employee-store"

type Context = { params: Promise<{ agentId: string }> }

/** Personnel → employee page → delete (no history) or dismiss (with history). Tenant administration only. */
export const POST = withMtmAttendanceAuth<Context>("write", async (req, auth, context) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    const agentId = (await context.params)?.agentId
    if (typeof agentId !== "string" || !agentId || agentId.length > 191) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await removeAttendanceEmployee({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, agentId, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
