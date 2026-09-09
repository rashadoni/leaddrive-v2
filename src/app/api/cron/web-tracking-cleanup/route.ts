import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWebTrackingCleanup } from "@/lib/queue/jobs/web-tracking-cleanup"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * C1 web-tracking retention cron — HTTP entry point (mirrors otp-cleanup).
 *
 * External cron nightly:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/web-tracking-cleanup \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    try {
      const result = await runWebTrackingCleanup(prisma)
      return NextResponse.json({ success: true, ...result })
    } catch (e) {
      console.error("[cron/web-tracking-cleanup]", e)
      return NextResponse.json({ error: "Cleanup failed" }, { status: 500 })
    }
  })
}
