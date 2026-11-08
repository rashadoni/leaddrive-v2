/**
 * Where Kapital Bank sends the customer back after paying a deposit, with
 * `?ID=<order id>&STATUS=<status>`. STATUS is not trusted — the bank calls it
 * temporary; the order is read from the bank before the meeting is touched.
 * The customer lands back on their own meeting page with the outcome.
 */
import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { findBookingByToken } from "@/lib/booking/book"
import { settleKapitalOrder } from "@/lib/payments/kapitalbank/invoice-checkout"

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findBookingByToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const orderId = (req.nextUrl.searchParams.get("ID") || "").trim()
  let outcome: string = "open"
  try {
    if (/^\d{1,20}$/.test(orderId)) {
      outcome = await runWithTenant(found.orgId, () =>
        settleKapitalOrder({ orgId: found.orgId, orderId, bookingId: found.bookingId }),
      )
    }
  } catch (e) {
    console.error("[public/booking] deposit return failed", e)
  }

  const page = new URL(`/book/cancel/${encodeURIComponent(token)}`, req.nextUrl.origin)
  page.searchParams.set("deposit", outcome === "paid" ? "paid" : outcome === "failed" ? "failed" : "pending")
  return NextResponse.redirect(page, 303)
}
