import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runOtpCleanup } from "@/lib/queue/jobs/otp-cleanup"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * OTP cleanup cron — HTTP entry point. Delegates to the extracted handler
 * in `src/lib/queue/jobs/otp-cleanup.ts`. Same handler will be invoked by
 * the BullMQ worker once Q4 slice 2 wires it; until then this HTTP route
 * is the sole execution path, and external cron remains authoritative.
 *
 * External cron every 6 hours:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/otp-cleanup \
 *        -H "x-cron-secret: $CRON_SECRET"
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const result = await runOtpCleanup(prisma)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error("[cron/otp-cleanup]", e)
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 })
  }
  })
}
