import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { withStationTiming } from "@/lib/station-timing"
import { recordStationHeartbeat, stationHeartbeatSchema } from "@/lib/voice-agent/pharmacy/station-heartbeat"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function authorized(request: Request): boolean {
  const expected = process.env.FANUM_VOICE_RUNTIME_TOKEN?.trim() || ""
  const received = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/iu)?.[1] || ""
  if (!expected || !received) return false
  const left = Buffer.from(expected), right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The station's once-a-minute report (scripts/pbx/fanum-station-heartbeat.py). */
async function handlePost(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await readJsonRequestWithinLimit(request, 1024)
  const parsed = body.ok ? stationHeartbeatSchema.safeParse(body.value) : null
  if (!parsed?.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  try {
    await recordStationHeartbeat(parsed.data)
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}

export const POST = withStationTiming("station-heartbeat", handlePost)
