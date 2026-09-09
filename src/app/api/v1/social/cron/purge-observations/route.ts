import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { purgeSocialObservationData } from "@/lib/social/observation-retention"

export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const result = await runWithRlsBypass(() => purgeSocialObservationData())
  return NextResponse.json({ success: result.failures === 0, data: result }, { status: result.failures === 0 ? 200 : 207 })
}
