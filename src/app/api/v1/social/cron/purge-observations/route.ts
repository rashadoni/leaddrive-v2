import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { purgeSocialObservationData } from "@/lib/social/observation-retention"
import { deleteSocialMonitoringDataBeyondRetention } from "@/lib/social/monitoring-age-retention"

export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const result = await runWithRlsBypass(async () => {
    const transit = await purgeSocialObservationData()
    // Nothing older than 30 days stays (owner, 2026-11-08). Runs after the
    // transit purge so provider dataset deletions are queued first.
    const beyondRetention = await deleteSocialMonitoringDataBeyondRetention()
    return { ...transit, beyondRetention }
  })
  const failures = result.failures + result.beyondRetention.failures.length
  console.log(`[social-retention] ${JSON.stringify(result.beyondRetention)}`)
  return NextResponse.json({ success: failures === 0, data: result }, { status: failures === 0 ? 200 : 207 })
}
