import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { bookingContext, bookingFilters, listBookings } from "@/lib/booking/queries"

export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = bookingFilters.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_FILTERS" }, { status: 400 })
  try {
    const [list, context] = await Promise.all([listBookings(access, parsed.data), bookingContext(access)])
    return NextResponse.json({ success: true, data: { ...list, ...context } }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURSOR") return NextResponse.json({ code: "INVALID_FILTERS" }, { status: 400 })
    throw error
  }
})
