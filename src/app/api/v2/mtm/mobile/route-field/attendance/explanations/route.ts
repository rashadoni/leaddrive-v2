import { withMobileRls } from "@/lib/with-mobile-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { answerOwnAttendanceExplanation, listOwnAttendanceExplanations } from "@/lib/mtm/attendance-explanation-store"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

/** The app's «Объяснительные»: HR's requests, the answers, and the days one may still explain. */
export const GET = withMobileRls(async (_req, auth) => {
  try { return attendanceRequestResponse(await listOwnAttendanceExplanations({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role })) }
  catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })

/** The employee writes (or corrects, until HR decides) an explanation for one day. */
export const POST = withMobileRls(async (req, auth) => {
  try {
    const body = await readJsonRequestWithinLimit(req, 8_192)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_EXPLANATION_INVALID", body.reason === "too_large" ? 413 : 400)
    const result = await answerOwnAttendanceExplanation({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, body.value)
    return attendanceRequestResponse(result, result.idempotent ? 200 : 201)
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
