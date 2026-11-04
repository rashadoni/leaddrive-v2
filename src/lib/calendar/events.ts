/**
 * Reading a connected calendar, whichever it is.
 *
 * Two depths, because they answer different questions:
 *   - `calendarBusy` is the cheap one the slot maths needs — when the host is
 *     taken, nothing about by what. The public page calls it for every host.
 *   - `calendarEvents` also brings each event's own identifier and title: the
 *     identifier so a meeting this CRM itself put there is not mistaken for a
 *     clash with itself, and the title so the staff day view can say what the
 *     hour is taken by instead of drawing a nameless grey block.
 *
 * Both fail loudly. A calendar that answers partly is the dangerous case: the
 * caller reads missing events as free time and books over them, so an
 * incomplete read must throw rather than return what it managed to get.
 */
import { getGoogleCalendarClient, listBusyIntervals } from "@/lib/google-calendar"
import { localDateTimeToUtc, isValidTimezone } from "@/lib/timezone"
import { microsoftAccessToken, microsoftEvents } from "./microsoft"
import type { ConnectedCalendar } from "./accounts"
import type { CalendarProvider } from "./providers"

export interface ExternalEvent {
  start: Date
  end: Date
  /** The provider's own id, where there is one; null for a free/busy read. */
  eventId: string | null
  title: string | null
  provider: CalendarProvider
}

export async function calendarBusy(account: ConnectedCalendar, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  if (account.provider === "google") {
    return (await listBusyIntervals(account.userId, from.toISOString(), to.toISOString(), account.id)) ?? []
  }
  const token = await microsoftAccessToken(account.id, account.userId)
  return (await microsoftEvents(token, from, to)).map(({ start, end }) => ({ start, end }))
}

export async function calendarEvents(account: ConnectedCalendar, from: Date, to: Date, deadline = Date.now() + 8000): Promise<ExternalEvent[]> {
  if (account.provider === "microsoft") {
    const token = await microsoftAccessToken(account.id, account.userId)
    return (await microsoftEvents(token, from, to, deadline)).map((event) => ({
      start: event.start, end: event.end, eventId: event.id || null, title: event.subject, provider: "microsoft" as const,
    }))
  }
  const calendar = await getGoogleCalendarClient(account.userId, account.id)
  const events: ExternalEvent[] = []
  let pageToken: string | undefined
  let read = 0
  do {
    if (Date.now() >= deadline || read >= 1000) throw new Error("incomplete calendar")
    const result = await calendar.events.list(
      { calendarId: "primary", timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, maxResults: 250, pageToken },
      { timeout: Math.max(1, deadline - Date.now()) },
    )
    // A free/busy-only grant cannot tell this code which event is its own, so
    // a move would compare the booking against itself and refuse every time.
    if (result.data.accessRole === "freeBusyReader" || result.data.accessRole === "none") throw new Error("insufficient calendar access")
    for (const event of result.data.items ?? []) {
      read++
      if (event.status === "cancelled" || event.transparency === "transparent") continue
      const allDayZone = event.start?.timeZone || event.end?.timeZone || result.data.timeZone
      if ((event.start?.date || event.end?.date) && !isValidTimezone(allDayZone)) throw new Error("unknown all-day calendar timezone")
      const start = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? localDateTimeToUtc(`${event.start.date}T00:00`, allDayZone!) : null
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? localDateTimeToUtc(`${event.end.date}T00:00`, allDayZone!) : null
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("unreadable calendar event")
      events.push({ start, end, eventId: event.id ?? null, title: event.summary?.trim() || null, provider: "google" })
    }
    pageToken = result.data.nextPageToken ?? undefined
  } while (pageToken)
  return events
}
