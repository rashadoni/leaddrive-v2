import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { changeAttendanceHrAccess, AttendanceHrAccessError } from "@/lib/mtm/attendance-hr-access"
type Context = { params: Promise<{ id: string }> }
export const PATCH = withMtmAttendanceAuth<Context>("write", async (req, auth, ctx) => {
  if (auth.principalType !== "session" || (auth.role !== "admin" && auth.role !== "superadmin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  try {
    const data = await changeAttendanceHrAccess(auth.orgId, auth.userId, (await ctx.params).id, await req.json().catch(() => null))
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof AttendanceHrAccessError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/access] change failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not change attendance access", code: "MTM_ATTENDANCE_HR_FAILED" }, { status: 500 })
  }
})
