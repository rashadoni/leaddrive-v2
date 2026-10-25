import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { refreshZeytunLineCatalog } from "@/lib/voice-agent/pharmacy/zeytun-catalog-refresh"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Keeps Zeytun's phone-line catalog under a day old (see the library's note). */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  try {
    const result = await refreshZeytunLineCatalog()
    return NextResponse.json(result, { status: result.outcome === "failed" ? 502 : 200 })
  } catch {
    // A malformed connection file: say so without echoing any of it.
    return NextResponse.json({ outcome: "failed", error: "invalid_configuration" }, { status: 502 })
  }
}
