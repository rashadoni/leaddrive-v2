import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { autoCloseExpiredTicketClosureRequests } from "@/lib/ticketing/closure-requests"

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const result = await runWithRlsBypass(() => autoCloseExpiredTicketClosureRequests())
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    console.error("[cron/ticket-closure-requests]", e)
    return NextResponse.json({ error: "Failed to auto-close ticket closure requests" }, { status: 500 })
  }
}
