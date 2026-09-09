import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runMtmRouteNotificationOutboxJob } from "@/lib/mtm/route-notification-outbox"

/**
 * Installed by the managed resilience-cron installer after the migration step
 * in a future approved deploy. The worker itself remains tenant-scoped,
 * lease-protected and idempotent.
 */
export async function POST(req: NextRequest) {
  const authError = requireCronAuth(req)
  if (authError) return authError

  try {
    const result = await runMtmRouteNotificationOutboxJob()
    if (result.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }
    return NextResponse.json({ success: true, data: result.value })
  } catch (error) {
    console.error("[MTM route notification outbox cron]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
