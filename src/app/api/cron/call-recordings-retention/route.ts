import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { purgeExpiredStationRecordings } from "@/lib/calls/station-recordings"

/**
 * Daily: delete the line's call recordings older than 90 days
 * (src/lib/calls/station-recordings.ts).
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const result = await purgeExpiredStationRecordings()
  return NextResponse.json({ success: true, ...result })
}
