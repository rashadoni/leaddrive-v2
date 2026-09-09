import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runMtmRouteDayCloseJob } from "@/lib/cron/mtm-route-day-close-job"

/**
 * Nightly close of routes nobody finished (field UX audit 2026-09-05, task A3).
 * The work, the timezone reasoning and what is deliberately left untouched are
 * documented in `src/lib/cron/mtm-route-day-close-job.ts`.
 *
 * Runs hourly: the boundary is each organization's own local morning, so a
 * single daily UTC tick would close the day at the wrong hour for every tenant
 * outside that offset. Repeated ticks are harmless — the update is idempotent,
 * and the PostgreSQL lease keeps two runners from overlapping.
 */
export async function POST(req: NextRequest) {
  // Authenticate before anything else: `runMtmRouteDayCloseJob` enters an RLS
  // bypass that can see every tenant.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  // Deploy verification calls this endpoint to prove the schedule is wired up.
  // It must not change a single row while doing so.
  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({
      success: true,
      data: { organizationsScanned: 0, routesClosed: 0, smoke: true },
    })
  }

  try {
    const result = await runMtmRouteDayCloseJob()
    if (result.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }
    return NextResponse.json({ success: true, data: result.value })
  } catch (error) {
    console.error("[MTM Cron] route-day-close failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
