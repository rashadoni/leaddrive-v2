import { bookingDb as prisma } from "./db"
import { connectedCalendarsOf } from "@/lib/calendar/accounts"
import { calendarEvents, type ExternalEvent } from "@/lib/calendar/events"
import { connectedCalendarKey } from "@/lib/calendar/providers"
import { BookingCommandError } from "./command-error"
import type { BusyInterval } from "./availability"

export interface BookingCalendarRead {
  /** For the slot maths: when the host is taken, nothing about by what. */
  intervals: BusyInterval[]
  /** The same time with each event's title, for screens that may show it. */
  events: ExternalEvent[]
  /**
   * Which calendars this answer came from. The write compares it again under
   * the host's lock: a calendar connected or dropped in between would mean
   * the booking was decided against time nobody read.
   */
  accountKey: string
  checkedAt: number
}

/**
 * Everything on this host's connected calendars that overlaps the window,
 * minus the events this CRM itself put there for that one meeting.
 *
 * Identity-aware, which free/busy cannot be: moving a meeting means asking
 * «is this hour free apart from me», and a free/busy answer cannot have its
 * own event subtracted from it.
 */
export async function bookingCalendarBusy(orgId: string, hostId: string, from: Date, to: Date, bookingId?: string): Promise<BookingCalendarRead> {
  const accounts = await connectedCalendarsOf(prisma, hostId)
  if (!accounts.length) return { intervals: [], events: [], accountKey: "", checkedAt: Date.now() }
  const bindings = bookingId ? await prisma.bookingIntegrationBinding.findMany({
    where: { organizationId: orgId, bookingId, hostUserId: hostId, accountId: { in: accounts.map((account) => account.id) } },
    select: { providerEventId: true },
  }) : []
  const ownIds = new Set(bindings.map((row) => row.providerEventId).filter((id): id is string => Boolean(id)))

  try {
    const deadline = Date.now() + 8000
    const found = (await Promise.all(accounts.map((account) => calendarEvents(account, from, to, deadline)))).flat()
    const events = found.filter((event) => !(event.eventId && ownIds.has(event.eventId)))
    return {
      intervals: events.map(({ start, end }) => ({ start, end })),
      events,
      accountKey: connectedCalendarKey(accounts),
      checkedAt: Date.now(),
    }
  } catch { throw new BookingCommandError("CALENDAR_UNAVAILABLE", 503) }
}
