import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { readAttribution } from "@/lib/ad-conversions/attribution"
import { bookSchema } from "@/lib/booking/booking-input"
import { z } from "zod"
import { createStoredBooking } from "@/lib/booking/create"
import { BookingCommandError } from "@/lib/booking/command-error"
import { IdempotencyConflictError } from "@/lib/event-platform/errors"
import { bookingFilters, listBookings } from "@/lib/booking/queries"

export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = bookingFilters.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_FILTERS" }, { status: 400 })
  try {
    const list = await listBookings(access, parsed.data)
    return NextResponse.json({ success: true, data: list }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURSOR") return NextResponse.json({ code: "INVALID_FILTERS" }, { status: 400 })
    throw error
  }
})


const createInput = bookSchema.extend({ pageId: z.string().min(1).max(64), hostUserId: z.string().min(1).max(64).optional() })
export const POST = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = createInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success || parsed.data.website) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  try {
    const result = await createStoredBooking(auth.orgId, parsed.data.pageId, { ...parsed.data, attribution: readAttribution(parsed.data.attribution, { userAgent: req.headers.get("user-agent") }) }, new Date(), access)
    if (!result.ok) return NextResponse.json({ code: result.reason === "taken" ? "SLOT_TAKEN" : "NOT_FOUND" }, { status: result.reason === "taken" ? 409 : 404 })
    const { id, startsAt, endsAt, hostName } = result.booking
    return NextResponse.json({ success: true, data: { id, startsAt, endsAt, hostName } }, { status: 201 })
  } catch (error) {
    if (error instanceof BookingCommandError) return NextResponse.json({ code: error.code }, { status: error.status })
    if (error instanceof IdempotencyConflictError) return NextResponse.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 })
    throw error
  }
})
