import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { bookingCommandInput, runBookingCommand } from "@/lib/booking/commands"
import { BookingCommandError } from "@/lib/booking/command-error"
import { IdempotencyConflictError } from "@/lib/event-platform/errors"

export const POST = withRlsAuth("bookings", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = bookingCommandInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  try {
    return NextResponse.json({ success: true, data: await runBookingCommand(access, (await params).id, parsed.data) })
  } catch (error) {
    if (error instanceof BookingCommandError) return NextResponse.json({ code: error.code }, { status: error.status })
    if (error instanceof IdempotencyConflictError) return NextResponse.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 })
    throw error
  }
})
