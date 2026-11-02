import { withMobileRls } from "@/lib/with-mobile-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { decideAttendanceRequest } from "@/lib/mtm/attendance-request-decision"
import { mobileAttendanceReviewer } from "@/lib/mtm/mobile-attendance-reviewer"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

type Context = { params: Promise<{ id: string }> }

/** The manager approves or rejects an employee's Personnel request from the app. */
export const POST = withMobileRls<Context>(async (req, auth, { params }) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  try {
    const reviewer = await mobileAttendanceReviewer(auth)
    if (!reviewer) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 8_192)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", body.reason === "too_large" ? 413 : 400)
    const { id } = await params
    return attendanceRequestResponse(await decideAttendanceRequest(reviewer, id, body.value))
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
