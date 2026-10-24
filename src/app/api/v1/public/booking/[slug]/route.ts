/**
 * A public booking link (/book/<slug>): GET the page and its free times, POST
 * a booking. The slug is public; what it reveals is what the organization
 * chose to publish. Rate limits come from the proxy (/api/v1/public/*).
 */
import { NextRequest, NextResponse } from "next/server"
import { bookSchema } from "@/lib/booking/booking-input"
import { runWithTenant } from "@/lib/rls-context"
import { createBooking, findBookingPageBySlug, publicBookingView } from "@/lib/booking/book"
import { BookingCommandError } from "@/lib/booking/command-error"
import { IdempotencyConflictError } from "@/lib/event-platform/errors"
import { readAttribution } from "@/lib/ad-conversions/attribution"


export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await findBookingPageBySlug(slug)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const view = await runWithTenant(found.orgId, () => publicBookingView(found.orgId, found.pageId))
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: view }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    if (e instanceof BookingCommandError) return NextResponse.json({ code: e.code }, { status: e.status })
    console.error("[public/booking] view failed", { code: "BOOKING_READ_FAILED" })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await findBookingPageBySlug(slug)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const parsed = bookSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message, code: "INVALID" }, { status: 400 })
  if (parsed.data.website) return NextResponse.json({ error: "Invalid", code: "INVALID" }, { status: 400 })

  try {
    const result = await runWithTenant(found.orgId, () => createBooking(found.orgId, found.pageId, {
      locale: parsed.data.locale,
      idempotencyKey: parsed.data.idempotencyKey,
      recoverySecret: parsed.data.recoverySecret,
      startsAt: parsed.data.startsAt,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      note: parsed.data.note || null,
      attribution: readAttribution(parsed.data.attribution, { userAgent: req.headers.get("user-agent") }),
    }))
    if (result.ok) return NextResponse.json({ success: true, data: result.booking }, { status: 201 })
    if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ error: "This time is taken", code: "TAKEN" }, { status: 409 })
  } catch (e) {
    if (e instanceof BookingCommandError) return NextResponse.json({ code: e.code }, { status: e.status })
    if (e instanceof IdempotencyConflictError) return NextResponse.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 })
    console.error("[public/booking] book failed", { code: "BOOKING_COMMAND_FAILED" })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
