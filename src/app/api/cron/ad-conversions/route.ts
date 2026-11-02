import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runAdConversions } from "@/lib/ad-conversions/worker"

/**
 * New leads and won deals to the organizations' ad platforms (Meta
 * Conversions API). Meta refuses a whole batch that holds an event older than
 * 7 days, so this runs often and never sends anything older than 6.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  try {
    return NextResponse.json({ success: true, data: await runAdConversions() })
  } catch (e) {
    console.error("[cron/ad-conversions]", e)
    return NextResponse.json({ error: "Failed to send ad conversions" }, { status: 500 })
  }
}
