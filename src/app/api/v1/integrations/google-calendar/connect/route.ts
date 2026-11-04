import { NextResponse } from "next/server"
// One API, not `import { google } from "googleapis"`: the root entry declares
// every Google API there is — 165 MB of typings for the type check to hold in
// memory, and 2.4 s of module loading against 0.3 s. The calendar module exports
// the same `auth` and `calendar`, so the calls below are unchanged.
import * as google from "googleapis/build/src/apis/calendar"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { signCalendarState } from "@/lib/calendar/oauth-state"

export const GET = withRlsSessionAuth(async (_req, session) => {

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 })
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/v1/integrations/google-calendar/callback`

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    state: signCalendarState(session.userId, session.orgId),
  })

  return NextResponse.json({ success: true, url: authUrl })
})
