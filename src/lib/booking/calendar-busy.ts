import { bookingDb as prisma } from "./db"
import { getGoogleCalendarClient } from "@/lib/google-calendar"
import { localDateTimeToUtc } from "@/lib/timezone"
import { BookingCommandError } from "./command-error"
import type { BusyInterval } from "./availability"

/** Identity-aware busy checks are required for moves; free/busy intervals cannot be subtracted. */
export async function bookingCalendarBusy(orgId: string, hostId: string, from: Date, to: Date, bookingId?: string) {
  const account = await prisma.account.findFirst({ where: { userId: hostId, provider: { in: ["google-calendar", "google"] } }, select: { id: true }, orderBy: { provider: "desc" } })
  if (!account) return { intervals: [] as BusyInterval[], accountId: null, checkedAt: Date.now() }
  const bindings = bookingId ? await prisma.bookingIntegrationBinding.findMany({ where: { organizationId: orgId, bookingId, hostUserId: hostId, accountId: account.id }, select: { providerEventId: true } }) : []
  const ownIds = new Set(bindings.map((row) => row.providerEventId))
  if (bookingId) {
    const legacy = await prisma.booking.findFirst({ where: { id: bookingId, organizationId: orgId, hostUserId: hostId }, select: { googleEventId: true } })
    if (legacy?.googleEventId) ownIds.add(legacy.googleEventId)
  }
  try {
    const calendar = await getGoogleCalendarClient(hostId, account.id)
    let pageToken: string | undefined
    let read = 0
    const deadline = Date.now() + 8000
    const intervals: BusyInterval[] = []
    do {
      if (Date.now() >= deadline || read >= 1000) throw new Error("incomplete calendar")
      const result = await calendar.events.list({ calendarId: "primary", timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, maxResults: 250, pageToken }, { timeout: Math.max(1, deadline - Date.now()) })
      if (result.data.accessRole === "freeBusyReader" || result.data.accessRole === "none") throw new Error("insufficient calendar access")
      for (const event of result.data.items ?? []) {
        read++
        if (event.id && ownIds.has(event.id) || event.status === "cancelled" || event.transparency === "transparent") continue
        const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? localDateTimeToUtc(`${event.start.date}T00:00`, event.start.timeZone || result.data.timeZone || "UTC") : null
        const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? localDateTimeToUtc(`${event.end.date}T00:00`, event.end.timeZone || result.data.timeZone || "UTC") : null
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("unreadable calendar event")
        intervals.push({ start, end })
      }
      pageToken = result.data.nextPageToken ?? undefined
    } while (pageToken)
    return { intervals, accountId: account.id, checkedAt: Date.now() }
  } catch { throw new BookingCommandError("CALENDAR_UNAVAILABLE", 503) }
}
