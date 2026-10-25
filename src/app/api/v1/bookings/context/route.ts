import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { bookingContext } from "@/lib/booking/queries"

export const GET = withRlsAuth("bookings", "read", async (_req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  return NextResponse.json({ success: true, data: await bookingContext(access) }, { headers: { "Cache-Control": "private, no-store" } })
})
