import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { warmZeytunLine } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { rehearseStationRoute } from "@/lib/voice-agent/pharmacy/zeytun-station-rehearsal"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Parses Zeytun's phone-line catalog into this process and rehearses a call's
 * first answer in it: the deploy calls it right after the new release starts,
 * so its first call finds everything in memory. */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const result = await warmZeytunLine().catch((error: unknown) => {
    console.error("[zeytun-line] warm failed:", error instanceof Error ? error.message : typeof error)
    return { outcome: "failed" as const }
  })
  // The route the station asks, once the line's own reads are in memory. Never the warm-up's failure.
  const route = result.outcome === "warm" ? await rehearseStationRoute() : undefined
  return NextResponse.json({ ...result, ...(route ? { route } : {}) }, { status: result.outcome === "failed" ? 502 : 200 })
}
