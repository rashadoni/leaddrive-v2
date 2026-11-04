/**
 * One host's day as their own connected calendars have it — so the meetings
 * section is the single window the salon actually works in, and a visit
 * arranged in Outlook is not invisible here until somebody double-books it.
 *
 * The time is already known: the day's free slots are computed with these
 * events subtracted. What this route adds is WHAT the hour is taken by, and
 * that is private: a title goes out only to the person whose calendar it is.
 * Anyone else entitled to see this host's day gets the hour and the name of
 * the calendar, exactly as much as the grey block already told them.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess, bookingHostWhere } from "@/lib/booking/access"
import { orgContext } from "@/lib/booking/book"
import { bookingDb as prisma } from "@/lib/booking/db"
import { connectedCalendarsOf } from "@/lib/calendar/accounts"
import { calendarEvents } from "@/lib/calendar/events"
import { localDateTimeToUtc } from "@/lib/timezone"

const input = z.object({ hostId: z.string().min(1).max(64), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const parsed = input.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  const { hostId, day } = parsed.data
  if (access.hostIds !== null && !access.hostIds.includes(hostId)) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  const host = await prisma.user.findFirst({ where: bookingHostWhere(access.orgId, [hostId]), select: { id: true } })
  if (!host) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })

  const accounts = await connectedCalendarsOf(prisma, hostId)
  if (!accounts.length) return NextResponse.json({ success: true, data: { events: [], unavailable: false } }, { headers: { "Cache-Control": "private, no-store" } })
  const org = await orgContext(access.orgId)
  const from = localDateTimeToUtc(`${day}T00:00`, org.timezone)
  const next = new Date(`${day}T12:00Z`); next.setUTCDate(next.getUTCDate() + 1)
  const to = localDateTimeToUtc(`${next.toISOString().slice(0, 10)}T00:00`, org.timezone)
  const ownCalendar = hostId === access.userId

  try {
    const deadline = Date.now() + 8000
    const found = (await Promise.all(accounts.map((account) => calendarEvents(account, from, to, deadline)))).flat()
    return NextResponse.json({
      success: true,
      data: {
        events: found.map((event) => ({ start: event.start.toISOString(), end: event.end.toISOString(), provider: event.provider, title: ownCalendar ? event.title : null })),
        unavailable: false,
      },
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    // The day still draws: the free slots came from the same calendars and
    // already refuse to offer unreadable time. Saying so is enough.
    return NextResponse.json({ success: true, data: { events: [], unavailable: true } }, { headers: { "Cache-Control": "private, no-store" } })
  }
})
