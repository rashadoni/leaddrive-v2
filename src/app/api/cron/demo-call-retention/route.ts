import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { purgeExpiredDemoCallText } from "@/lib/demo-center/call-retention"

/**
 * Daily: remove the words of demo calls older than 90 days — the promise the
 * agent makes in its first sentence (src/lib/demo-center/call-retention.ts).
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const result = await purgeExpiredDemoCallText()
  return NextResponse.json({ success: true, ...result })
}

