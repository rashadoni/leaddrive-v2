import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runBookingEffectWorker } from "@/lib/booking/effect-worker"
import { runWhatsAppDeferredTurnJob } from "@/lib/booking/whatsapp-deferred-turn"

export async function POST(req: NextRequest) {
  const error = requireCronAuth(req)
  if (error) return error
  const effects = await runBookingEffectWorker()
  // The booking agent's turn on a number the team also answers from a phone
  // (lib/booking/whatsapp-deferred-turn). It rides this tick instead of a
  // schedule of its own for one reason: the host already starts fifteen jobs
  // in some minutes, which is the cap `cron-trigger-spread` guards, and this
  // is the booking module's own minute. It carries its own lease, so sharing a
  // tick cannot make two runs take the same message.
  //
  // Wrapped: the effects above are what the deploy's post-checks assert, and a
  // failure in the agent's turn must not take them down with it.
  const deferredTurn = await runWhatsAppDeferredTurnJob().catch((err) => {
    console.error("[booking-effects] deferred WhatsApp turn failed:", err)
    return { status: "failed" as const }
  })
  return NextResponse.json({ success: true, data: { ...effects, deferredTurn } })
}
