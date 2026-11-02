import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readAttendanceEmployee, updateAttendanceEmployee } from "@/lib/mtm/attendance-employee-store"

type Context = { params: Promise<{ agentId: string }> }
const agentIdOf = async (context: unknown) => {
  const agentId = (await (context as Context).params)?.agentId
  if (typeof agentId !== "string" || !agentId || agentId.length > 191) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
  return agentId
}

/** Personnel → Employees → one employee's page (owner, 2026-10-16). Tenant administration only. */
export const GET = withMtmAttendanceAuth("read", async (_req, auth, context) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    return attendanceRequestResponse(await readAttendanceEmployee({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, await agentIdOf(context)))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req, auth, context) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    const body = await readJsonRequestWithinLimit(req, 8192)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await updateAttendanceEmployee({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, await agentIdOf(context), body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
