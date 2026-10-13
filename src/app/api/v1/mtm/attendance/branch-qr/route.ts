import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { readAttendanceQrDirectory, issueAttendanceBranchQr } from "@/lib/mtm/attendance-qr-store"

export const GET = withMtmAttendanceAuth("write", async (_req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_QR_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceQrDirectory({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }))
  } catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_QR_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 512)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_QR_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await issueAttendanceBranchQr({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
})
