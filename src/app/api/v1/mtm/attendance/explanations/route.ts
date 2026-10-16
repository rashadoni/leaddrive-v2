import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { listAttendanceExplanations, requestAttendanceExplanations } from "@/lib/mtm/attendance-explanation-store"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

/** Personnel → explanations HR asked for or employees wrote (owner, 2026-10-16). */
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const params = new URL(req.url).searchParams
    return attendanceRequestResponse(await listAttendanceExplanations({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType },
      { from: params.get("from") ?? "", to: params.get("to") ?? "" }))
  } catch (error) { return attendanceRequestFailure(error) }
})

/** «Запросить объяснительную» for the people ticked on Today. */
export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const result = await requestAttendanceExplanations({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, await req.json().catch(() => null))
    return attendanceRequestResponse(result, result.created ? 201 : 200)
  } catch (error) { return attendanceRequestFailure(error) }
})
