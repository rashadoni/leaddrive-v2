import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceDayKindError, readAttendanceDayKinds, saveAttendanceDayKinds } from "@/lib/mtm/attendance-day-kind-store"

export const GET = withMtmAttendanceAuth("read", async (_req, auth) => NextResponse.json({ success: true, data: {
  ...await readAttendanceDayKinds(auth.orgId), canManage: auth.principalType === "session" && (auth.role === "admin" || auth.role === "superadmin"),
} }, { headers: { "Cache-Control": "private, no-store" } }))

export const PUT = withMtmAttendanceAuth("write", async (req, auth) => {
  if (auth.principalType !== "session" || (auth.role !== "admin" && auth.role !== "superadmin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  try {
    return NextResponse.json({ success: true, data: await saveAttendanceDayKinds(auth.orgId, auth.userId, await req.json().catch(() => null)) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof AttendanceDayKindError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/day-kinds] save failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not save day kinds", code: "MTM_ATTENDANCE_DAY_KINDS_FAILED" }, { status: 500 })
  }
})
