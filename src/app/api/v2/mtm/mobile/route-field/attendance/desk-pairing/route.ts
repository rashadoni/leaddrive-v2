import { withMobileRls } from "@/lib/with-mobile-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { startAttendanceDeskPairing } from "@/lib/mtm/attendance-desk-screen"

/** The phone read a desk's pairing QR: the desk becomes this employee's workplace (`attendance-desk-screen.ts`). */
export const POST = withMobileRls(async (req, auth) => {
  try {
    const body = await readJsonRequestWithinLimit(req, 512)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_DESK_TOKEN_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await startAttendanceDeskPairing({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, body.value), 201)
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
