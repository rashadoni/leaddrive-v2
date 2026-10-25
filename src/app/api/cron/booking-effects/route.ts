import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runBookingEffectWorker } from "@/lib/booking/effect-worker"

export async function POST(req: NextRequest) {
  const error = requireCronAuth(req)
  if (error) return error
  return NextResponse.json({ success: true, data: await runBookingEffectWorker() })
}
