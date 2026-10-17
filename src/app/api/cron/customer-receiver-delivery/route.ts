import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runConfiguredReceiverRuntime } from "@/lib/integrations/customer-receiver/runtime/app-runtime"

/**
 * Customer receiver (AAC) retention + delivery tick.
 *
 * Disabled by default: without CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE it
 * reports `not_configured` and touches nothing; delivery additionally needs
 * CUSTOMER_RECEIVER_DELIVERY_ENABLED=on and an enabled, contract-approved
 * binding with a target and credential files. No crontab entry is installed
 * by this change. Each binding runs in its own tenant transactions (no RLS
 * bypass). The response carries counts only — no payloads, URLs or secrets.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  try {
    const result = await runConfiguredReceiverRuntime({ maxEffects: 100 })
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ ok: false, error: "customer_receiver_runtime_failed" }, { status: 500 })
  }
}
