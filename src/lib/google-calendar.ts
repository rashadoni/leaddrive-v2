import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/v1/integrations/google-calendar/callback`
  )
}

export async function getGoogleCalendarClient(userId: string) {
  // Get tokens from Account model — check both "google-calendar" (standalone) and "google" (SSO)
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: { in: ["google-calendar", "google"] },
      access_token: { not: null },
    },
    orderBy: { provider: "asc" }, // prefer "google-calendar" (standalone) over "google" (SSO)
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
      await prisma.account.update({
        where: { id: account.id },
        data: {
          access_token: tokens.access_token,
          ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
          ...(tokens.expiry_date ? { expires_at: Math.floor(tokens.expiry_date / 1000) } : {}),
        },
      })
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
