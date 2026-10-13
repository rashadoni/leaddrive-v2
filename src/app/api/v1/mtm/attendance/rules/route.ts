import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { attendanceRuleForDate, attendanceRuleMinimumDate } from "@/lib/mtm/attendance-rules"
import { AttendanceRuleError, createAttendanceRule, readAttendanceRules } from "@/lib/mtm/attendance-rule-store"

export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  const versions = await readAttendanceRules(auth.orgId)
  const today = currentDateKey(new Date(), auth.settings.timezone)
  return NextResponse.json({ success: true, data: {
    current: attendanceRuleForDate(versions, today), versions, today,
    minEffectiveFrom: attendanceRuleMinimumDate(versions, auth.settings.timezone),
    canManageRules: auth.role === "admin" || auth.role === "superadmin",
  } })
})

export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })
  }
  try {
    const rule = await createAttendanceRule(auth.orgId, auth.userId, auth.settings.timezone, await req.json().catch(() => null))
    return NextResponse.json({ success: true, data: rule }, { status: 201 })
  } catch (error) {
    if (error instanceof AttendanceRuleError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    console.error("[MTM/attendance/rules] rule creation failed", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Could not save rule", code: "MTM_ATTENDANCE_RULE_SAVE_FAILED" }, { status: 500 })
  }
})
