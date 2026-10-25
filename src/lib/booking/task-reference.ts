import { NextResponse } from "next/server"
import { bookingDb } from "./db"
import { bookingScope, type BookingAccess } from "./access"
import { BOOKING_WORKSPACE_ENABLED } from "./release-phase"

/** The database guard remains the final authority, including concurrent links. */
export async function bookingTaskConflict(orgId: string, taskId: string) {
  const booking = await bookingDb.booking.findFirst({
    where: { organizationId: orgId, taskId }, select: { version: true },
  })
  if (!booking || (!BOOKING_WORKSPACE_ENABLED && booking.version === 0)) return null
  return NextResponse.json({
    code: "BOOKING_MANAGED_TASK",
    error: "This task is managed by a meeting. Open the meeting to make changes.",
  }, { status: 409 })
}

/** A task reader does not automatically have permission to know a booking ID. */
export async function taskMeetingReference(access: BookingAccess, taskId: string) {
  const rows = await bookingDb.booking.findMany({
    where: { AND: [bookingScope(access), { taskId }] },
    select: { id: true }, take: 2,
  })
  if (!rows.length) return null
  // Ambiguous historical links must not pick an arbitrary appointment.
  return { bookingId: rows.length === 1 ? rows[0].id : null }
}
