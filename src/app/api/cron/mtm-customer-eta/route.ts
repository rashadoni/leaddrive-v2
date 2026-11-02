import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runCustomerEtaLinkJob } from "@/lib/mtm/customer-eta-link-job"
export const runtime = "nodejs"
/**
 * POST /api/cron/mtm-customer-eta — every minute: «агент едет к вам»,
 * the link the bot sends the customer an agent has set off to
 * (src/lib/mtm/customer-eta-link-job.ts). Nothing is sent for an
 * organization that has not switched it on.
 */
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  if (new URL(req.url).searchParams.get("smoke") === "1") return NextResponse.json({ success: true, data: { smoke: true, processed: 0 } })
  try {
    const result = await runCustomerEtaLinkJob()
    return NextResponse.json(result.status === "skipped" ? { success: true, skipped: true, reason: result.reason } : { success: true, data: result.value })
  } catch {
    console.error("[MTM Cron] customer ETA links failed")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
