import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { saveAttendanceDeskRule } from "@/lib/mtm/attendance-desk-screen"

/** «Сотрудники могут сами подключать свой компьютер» (administrators; `attendance-desk-screen.ts`). */
export const PUT = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DESK_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 256)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_DESK_INVALID", body.reason === "too_large" ? 413 : 400)
    const enabled = body.value && typeof body.value === "object" ? (body.value as { enabled?: unknown }).enabled : undefined
    return attendanceRequestResponse(await saveAttendanceDeskRule({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, enabled))
  } catch (error) { return attendanceRequestFailure(error) }
})
