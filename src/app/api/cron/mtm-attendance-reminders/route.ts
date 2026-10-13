import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runMtmAttendanceReminderJob } from "@/lib/cron/mtm-attendance-reminder-job"
export const runtime = "nodejs"
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  if (new URL(req.url).searchParams.get("smoke") === "1") return NextResponse.json({ success: true, data: { smoke: true, processed: 0 } })
  try {
    const result = await runMtmAttendanceReminderJob()
    return NextResponse.json(result.status === "skipped" ? { success: true, skipped: true, reason: result.reason } : { success: true, data: result.value })
  } catch {
    console.error("[MTM Cron] attendance reminders failed")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
