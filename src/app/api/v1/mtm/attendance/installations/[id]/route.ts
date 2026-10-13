import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestResponse, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { decideAttendanceInstallation } from "@/lib/mtm/attendance-installation-store"
type InstallationRouteContext = { params: Promise<{ id: string }> }
export const POST = withMtmAttendanceAuth<InstallationRouteContext>("write", async (req, auth, context) => {
  try {
    const body = await readJsonRequestWithinLimit(req, 8192)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_INSTALLATION_DECISION_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await decideAttendanceInstallation({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, (await context.params).id, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
