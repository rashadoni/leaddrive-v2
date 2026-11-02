import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { bookingDb as prisma } from "@/lib/booking/db"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess, bookingScope } from "@/lib/booking/access"
import { bookingHistory } from "@/lib/booking/queries"

export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const cursor = z.coerce.number().int().positive().optional().safeParse(req.nextUrl.searchParams.get("before") ?? undefined)
  if (!cursor.success) return NextResponse.json({ code: "INVALID_CURSOR" }, { status: 400 })
  const { id } = await params
  if (!await prisma.booking.findFirst({ where: { AND: [bookingScope(access), { id }] }, select: { id: true } })) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  return NextResponse.json({ success: true, data: await bookingHistory(access, id, cursor.data) }, { headers: { "Cache-Control": "private, no-store" } })
})
