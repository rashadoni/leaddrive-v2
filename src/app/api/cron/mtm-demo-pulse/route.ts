import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runMtmDemoPulseJob } from "@/lib/mtm/demo-pulse"

/**
 * Every ten minutes: advance the demo organization's field day
 * (src/lib/mtm/demo-pulse.ts). Only organizations flagged `mtm-demo-pulse`
 * are touched; every write is keyed, so a repeated tick changes nothing.
 */
export async function POST(req: NextRequest) {
  // Authenticate first: the job enters an RLS bypass to find flagged tenants.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({ success: true, data: { organizations: 0, agents: [], smoke: true } })
  }

  try {
    const result = await runMtmDemoPulseJob()
    if (result.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }
    return NextResponse.json({ success: true, data: result.value })
  } catch (error) {
    console.error("[MTM Cron] demo-pulse failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
