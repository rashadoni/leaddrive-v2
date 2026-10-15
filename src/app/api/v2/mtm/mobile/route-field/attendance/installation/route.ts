import { NextResponse } from "next/server"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestResponse, attendanceRequestFailure, attendancePrivateHeaders } from "@/lib/mtm/attendance-request-http"
import { readOwnAttendanceInstallation, submitAttendanceInstallation } from "@/lib/mtm/attendance-installation-store"
export const GET = withMobileRls(async (req, auth) => {
  try { return attendanceRequestResponse(await readOwnAttendanceInstallation({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, req.headers.get("x-field-device-id"))) }
  catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
export const POST = withMobileRls(async (req, auth) => {
  try {
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_INSTALLATION_REQUEST_INVALID", body.reason === "too_large" ? 413 : 400)
    return attendanceRequestResponse(await submitAttendanceInstallation({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, req.headers.get("x-field-device-id"), body.value))
  } catch (error) {
    if (error instanceof AttendanceRequestError && error.code === "MTM_ATTENDANCE_INSTALLATION_ALREADY_REQUESTED") {
      return NextResponse.json({ error: error.code, code: error.code, data: { committed: false } }, { status: 409, headers: attendancePrivateHeaders })
    }
    return attendanceRequestFailure(error)
  }
}, { requiredCapability: "personnel" })
