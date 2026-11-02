import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { reconcileKapitalIntents } from "@/lib/payments/kapitalbank/invoice-checkout"

/**
 * Card payments whose customer never came back from Kapital Bank's page: the
 * bank has no server-to-server callback, so each open order is asked about
 * until it is paid, refused or abandoned (48 hours).
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const result = await reconcileKapitalIntents()
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    console.error("[cron/kapitalbank-reconcile]", e)
    return NextResponse.json({ error: "Failed to reconcile Kapital Bank payments" }, { status: 500 })
  }
}
