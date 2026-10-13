import { NextRequest, NextResponse } from "next/server"
import type { AttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceViewSessionError } from "@/lib/mtm/attendance-view-api"
import { AttendanceDeliveryError, saveAttendanceDelivery } from "@/lib/mtm/attendance-delivery-store"

export async function mutateAttendanceDelivery(req: NextRequest, auth: AttendanceAuth, id?: string, remove = false) {
  const denied = attendanceViewSessionError(auth)
  if (denied) return denied
  try {
    const data = await saveAttendanceDelivery({ organizationId: auth.orgId, userId: auth.userId, timezone: auth.settings.timezone, value: await req.json().catch(() => null), id, remove })
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof AttendanceDeliveryError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/deliveries] save failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not save schedule", code: "MTM_ATTENDANCE_DELIVERY_FAILED" }, { status: 500 })
  }
}
