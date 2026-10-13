import { NextRequest, NextResponse } from "next/server"
import type { AttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceViewError, saveAttendanceView } from "@/lib/mtm/attendance-view-store"

export function attendanceViewSessionError(auth: AttendanceAuth) {
  return auth.principalType === "session" ? null : NextResponse.json({ error: "A personal session is required", code: "MTM_ATTENDANCE_VIEW_SESSION_REQUIRED" }, { status: 403 })
}
export async function mutateAttendanceView(req: NextRequest, auth: AttendanceAuth, id?: string, remove = false) {
  const denied = attendanceViewSessionError(auth)
  if (denied) return denied
  try {
    const data = await saveAttendanceView({ organizationId: auth.orgId, userId: auth.userId, value: await req.json().catch(() => null), id, remove })
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof AttendanceViewError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/views] save failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not save form", code: "MTM_ATTENDANCE_VIEW_FAILED" }, { status: 500 })
  }
}
