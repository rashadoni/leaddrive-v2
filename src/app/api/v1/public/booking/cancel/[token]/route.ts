/**
 * The customer's cancel link (/book/cancel/<token>). The token is the whole
 * credential; only its sha256 is stored.
 */
import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { bookingCancelView, cancelBooking, findBookingByToken } from "@/lib/booking/book"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findBookingByToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const view = await runWithTenant(found.orgId, () => bookingCancelView(found.orgId, found.bookingId))
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: view }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await findBookingByToken(token)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const outcome = await runWithTenant(found.orgId, () => cancelBooking(found.orgId, found.bookingId))
    if (outcome === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (outcome === "past") return NextResponse.json({ error: "The meeting has passed", code: "PAST" }, { status: 409 })
    return NextResponse.json({ success: true, data: { status: "cancelled" } })
  } catch (e) {
    console.error("[public/booking] cancel failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
