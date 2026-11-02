import { NextResponse } from "next/server"

import { processRole } from "@/lib/station-timing"
import { loadStationReport } from "@/lib/voice-agent/pharmacy/station-heartbeat"
import { createLineHealthCheck } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { zeytunLineHost } from "@/lib/voice-agent/pharmacy/zeytun-line-host"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// The line watch (scripts/zeytun-line/watch.mjs) asks here once a minute, by
// the way the station comes: Cloudflare, nginx, the line process. No token:
// only three yes/no answers, the station's state in one word and which process
// gave them leave the process.
const check = createLineHealthCheck({ ...zeytunLineHost(), loadStation: () => loadStationReport() })

export async function GET() {
  const health = await check()
  return NextResponse.json({ ...health, proc: processRole() },
    { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } })
}
