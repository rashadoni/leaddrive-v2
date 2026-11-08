/**
 * «Pay the deposit» on the customer's own meeting link: opens a Kapital Bank
 * order for exactly what this visit was asked for and answers with the bank's
 * payment page to go to.
 *
 * The credential is the meeting token the customer already has — the same one
 * their cancel link carries. Nothing in the request says how much: the amount
 * comes from the meeting.
 */
import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { findBookingByToken } from "@/lib/booking/book"
import { startDepositCheckout } from "@/lib/booking/deposit-checkout"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findBookingByToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const result = await runWithTenant(found.orgId, () =>
      startDepositCheckout({ orgId: found.orgId, bookingId: found.bookingId, token }),
    )
    if (result.ok) return NextResponse.json({ success: true, data: { url: result.url } })
    if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.reason === "bank_error") return NextResponse.json({ error: "Bank is unavailable", code: "BANK_ERROR" }, { status: 502 })
    return NextResponse.json({ error: "Online payment is unavailable", code: result.reason.toUpperCase() }, { status: 409 })
  } catch (e) {
    console.error("[public/booking] deposit checkout failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
