import { Prisma } from "@prisma/client"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { readAttendanceLeaveBalances } from "@/lib/mtm/attendance-leave-store"
export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  const startedAt = Date.now()
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_LEAVE_FORBIDDEN", 403)
    return attendanceRequestResponse(await readAttendanceLeaveBalances({ organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, Object.fromEntries(req.nextUrl.searchParams))) }
  catch (error) {
    // Disposable hosted fixture only; never emit payloads, SQL, messages or IDs.
    if (process.env.MTM_ATTENDANCE_E2E === "1" && process.env.NODE_ENV !== "production") {
      const code = error instanceof Prisma.PrismaClientKnownRequestError && ["P2028", "P2024", "P2034", "P2010"].includes(error.code) ? error.code : "OTHER"
      const expired = error instanceof Prisma.PrismaClientKnownRequestError && typeof error.meta?.error === "string" && /expired transaction|Transaction already closed/i.test(error.meta.error)
      try { console.error("MTM_LEAVE_READ_DIAGNOSTIC " + JSON.stringify({ code, expired, elapsedMs: Math.max(0, Date.now() - startedAt) })) } catch { /* diagnostics preserve the original result */ }
    }
    return attendanceRequestFailure(error)
  }
})
