import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runAzCalendarWatch } from "@/lib/mtm/az-calendar-watch"

export const runtime = "nodejs"

/** Hourly: look for next year's official holidays (src/lib/mtm/az-calendar-watch.ts). */
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  if (new URL(req.url).searchParams.get("smoke") === "1") return NextResponse.json({ success: true, data: { smoke: true } })
  try {
    const result = await runAzCalendarWatch()
    return NextResponse.json(result.status === "skipped" ? { success: true, skipped: true, reason: result.reason } : { success: true, data: result.value })
  } catch {
    console.error("[MTM Cron] calendar watch failed")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
