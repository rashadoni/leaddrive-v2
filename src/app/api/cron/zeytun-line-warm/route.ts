import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { warmZeytunLine } from "@/lib/voice-agent/pharmacy/zeytun-line-host"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Parses Zeytun's phone-line catalog into this process: the deploy calls it
 * right after the new release starts, so its first call finds it in memory. */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const result = await warmZeytunLine().catch((error: unknown) => {
    console.error("[zeytun-line] warm failed:", error instanceof Error ? error.message : typeof error)
    return { outcome: "failed" as const }
  })
  return NextResponse.json(result, { status: result.outcome === "failed" ? 502 : 200 })
}
