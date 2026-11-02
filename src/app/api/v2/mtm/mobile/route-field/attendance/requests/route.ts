import { z } from "zod"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { prisma } from "@/lib/prisma"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { listOwnAttendanceRequests, requireAttendanceSelf, submitAttendanceRequest } from "@/lib/mtm/attendance-request-store"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"

export const GET = withMobileRls(async (req, auth) => {
  try {
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined
    if (cursor && !z.string().uuid().safeParse(cursor).success) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", 400)
    return attendanceRequestResponse(await listOwnAttendanceRequests({ organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }, cursor))
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })

export const POST = withMobileRls(async (req, auth) => {
  const self = { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }
  try {
    await requireAttendanceSelf(prisma, self)
    const body = await readJsonRequestWithinLimit(req, 16_384)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", body.reason === "too_large" ? 413 : 400)
    const result = await submitAttendanceRequest(self, body.value)
    return attendanceRequestResponse(result, result.idempotent ? 200 : 201)
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "personnel" })
