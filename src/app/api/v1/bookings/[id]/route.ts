import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { bookingDetail } from "@/lib/booking/queries"

export const GET = withRlsAuth("bookings", "read", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const { id } = await params
  const data = await bookingDetail(access, id, auth.role)
  return data ? NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } })
    : NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
})
