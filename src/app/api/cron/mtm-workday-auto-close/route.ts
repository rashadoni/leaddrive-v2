import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runMtmWorkdayAutoCloseJob } from "@/lib/cron/mtm-workday-auto-close-job"

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const result = await runMtmWorkdayAutoCloseJob()
    if (result.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }
    return NextResponse.json({ success: true, data: result.value })
  } catch (error) {
    console.error("[MTM workday auto-close] Error:", error instanceof Error ? error.name : "unknown")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
