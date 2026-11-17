import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runProcurementOverdueJob } from "@/lib/procurement/overdue-job"

/** Hourly: purchase orders whose supplier is late (src/lib/procurement/overdue-job.ts). */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  try {
    const result = await runProcurementOverdueJob()
    if (result.status === "skipped") return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    return NextResponse.json({ success: true, data: result.value })
  } catch (error) {
    console.error("[Procurement overdue] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
