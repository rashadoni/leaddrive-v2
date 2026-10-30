// One API, not `import { google } from "googleapis"`: the root entry declares
// every Google API there is — 165 MB of typings for the type check to hold in
// memory, and 2.4 s of module loading against 0.3 s. The calendar module exports
// the same `auth` and `calendar`, so the calls below are unchanged.
import * as google from "googleapis/build/src/apis/calendar"
import { prisma } from "@/lib/prisma"
import { calendarAccount } from "./google-calendar-account"

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/v1/integrations/google-calendar/callback`
  )
}

export async function getGoogleCalendarClient(userId: string, accountId?: string) {
  const selectedId = accountId ?? (await calendarAccount(prisma, userId))?.id
  if (!selectedId) throw new Error("Google Calendar not connected")
  const account = await prisma.account.findFirst({
    where: {
      userId,
      id: selectedId,
      provider: { in: ["google-calendar", "google"] },
      access_token: { not: null },
    },
  })

  if (!account?.access_token) {
    throw new Error("Google Calendar not connected. Please connect via Settings → Integrations.")
  }

  // If token expired and no refresh_token, can't proceed
  const expired = account.expires_at ? account.expires_at * 1000 < Date.now() : false
  if (expired && !account.refresh_token) {
    throw new Error("Google Calendar not connected. Token expired — please reconnect via Settings → Integrations.")
  }

  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  })

  // Handle token refresh — update whichever provider we found
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.account.updateMany({
        where: { id: account.id, access_token: account.access_token, refresh_token: account.refresh_token ?? null },
        data: {
          access_token: tokens.access_token,
          ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
          ...(tokens.expiry_date ? { expires_at: Math.floor(tokens.expiry_date / 1000) } : {}),
        },
      }).catch(() => { console.warn("[Google Calendar] token persistence unavailable") })
    }
  })

  return google.calendar({ version: "v3", auth: oauth2Client })
}

export async function createCalendarEvent(userId: string, event: {
  summary: string
  description?: string
  startTime: string
  endTime?: string
  attendees?: string[]
}) {
  const calendar = await getGoogleCalendarClient(userId)

  const endTime = event.endTime || new Date(new Date(event.startTime).getTime() + 3600000).toISOString()

  const result = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startTime },
      end: { dateTime: endTime },
      attendees: event.attendees?.map(email => ({ email })),
    },
  })

  return result.data
}

export async function listCalendarEvents(userId: string, timeMin: string, timeMax: string) {
  const calendar = await getGoogleCalendarClient(userId)

  const result = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  })

  return result.data.items ?? []
}

/**
 * Busy time on the user's primary calendar between two instants (free/busy,
 * so no event details are read). Null when the user has no calendar
 * connected — the caller treats that as "nothing known", not as an error.
 */
export async function listBusyIntervals(userId: string, timeMin: string, timeMax: string, checkedAccountId?: string | null): Promise<{ start: Date; end: Date }[] | null> {
  const accountId = checkedAccountId === undefined ? (await calendarAccount(prisma, userId))?.id : checkedAccountId
  if (!accountId) return null
  const calendar = await getGoogleCalendarClient(userId, accountId)
  const result = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: "primary" }] },
  }, { timeout: 8000 })
  if (!result.data.calendars?.primary || result.data.calendars.primary.errors?.length) throw new Error("Calendar availability unavailable")
  const busy = result.data.calendars.primary.busy ?? []
  return busy
    .filter((item) => item.start && item.end)
    .map((item) => ({ start: new Date(item.start as string), end: new Date(item.end as string) }))
}

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<void> {
  const calendar = await getGoogleCalendarClient(userId)
  await calendar.events.delete({ calendarId: "primary", eventId })
}
