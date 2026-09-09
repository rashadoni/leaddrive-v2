import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runFinanceDeadlineJob } from "@/lib/cron/finance-deadline-job"

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const result = await runFinanceDeadlineJob()
    if (result.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }
    return NextResponse.json({ success: true, data: result.value })
  } catch (error) {
    console.error("[Finance Cron] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
