import { prisma } from "@/lib/prisma"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { readAttendanceBreakKinds, saveAttendanceBreakKinds } from "@/lib/mtm/attendance-break-kinds"

/** Personnel → Settings → Kinds of breaks: the list (GET) and the whole list saved at once (PUT, administrators). */
export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_FORBIDDEN", 403)
    const [settings, user] = await Promise.all([readAttendanceBreakKinds(prisma, auth.orgId),
      prisma.user.findFirst({ where: { organizationId: auth.orgId, id: auth.userId }, select: { role: true } })])
    return attendanceRequestResponse({ ...settings, canConfigure: !!user && ["admin", "superadmin"].includes(user.role) })
  } catch (error) { return attendanceRequestFailure(error) }
})
export const PUT = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_FORBIDDEN", 403)
    const body = await readJsonRequestWithinLimit(req, 8192)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_BREAK_KINDS_INVALID", body.reason === "too_large" ? 413 : 400)
    const saved = await saveAttendanceBreakKinds({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, body.value)
    return attendanceRequestResponse({ ...saved.settings, changed: saved.changed, canConfigure: true })
  } catch (error) { return attendanceRequestFailure(error) }
})
