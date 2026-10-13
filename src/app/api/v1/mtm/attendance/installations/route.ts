import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestResponse, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { readAttendanceInstallationQueue } from "@/lib/mtm/attendance-installation-store"
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try { return attendanceRequestResponse(await readAttendanceInstallationQueue({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, Object.fromEntries(req.nextUrl.searchParams))) }
  catch (error) { return attendanceRequestFailure(error) }
})
