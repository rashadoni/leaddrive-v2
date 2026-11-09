import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWhatsAppDeferredTurnJob } from "@/lib/booking/whatsapp-deferred-turn"

export const runtime = "nodejs"

/**
 * POST /api/cron/whatsapp-deferred-turn — the booking agent's turn on a number that also lives in
 * the WhatsApp Business app, a minute after the customer wrote
 * (src/lib/booking/whatsapp-deferred-turn.ts).
 *
 * A no-op for every workspace whose WhatsApp number is not held, which today is all of them. Each
 * message is claimed before anything is sent, so the route is safe to call at any cadence, by hand
 * included.
 */
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({ success: true, data: { smoke: true, candidates: 0 } })
  }
  try {
    const result = await runWhatsAppDeferredTurnJob()
    return NextResponse.json(
      result.status === "skipped"
        ? { success: true, skipped: true, reason: result.reason }
        : { success: true, data: result.value },
    )
  } catch {
    console.error("[WA Deferred] run failed")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
