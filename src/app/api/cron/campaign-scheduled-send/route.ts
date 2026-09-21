import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runScheduledCampaignSends } from "@/lib/campaigns/scheduled-send-job"

/**
 * Sends campaigns whose scheduled time has come. Every minute from
 * `scripts/install-resilience-crons.sh`. Why a campaign can never go out twice
 * is documented in `src/lib/campaigns/scheduled-send-job.ts`.
 */
export async function POST(req: NextRequest) {
  // Authenticate first: the job discovers due campaigns across every tenant.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  // Deploy verification proves the schedule is wired up. It must not send.
  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({ success: true, data: { due: 0, sent: 0, smoke: true } })
  }

  try {
    const summary = await runScheduledCampaignSends()
    return NextResponse.json({ success: true, data: summary })
  } catch (error) {
    console.error("[Campaign Cron] scheduled-send failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
