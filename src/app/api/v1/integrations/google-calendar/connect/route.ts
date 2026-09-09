import { NextResponse } from "next/server"
import { google } from "googleapis"
import crypto from "node:crypto"
import { withRlsSessionAuth } from "@/lib/with-rls"

const STATE_TTL_MS = 10 * 60_000
function oauthStateSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || ""
}
function signState(userId: string, orgId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, orgId, exp: Date.now() + STATE_TTL_MS, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url")
  const sig = crypto.createHmac("sha256", oauthStateSecret()).update(payload).digest("base64url")
  return `${payload}.${sig}`
}

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
    state: signState(session.userId, session.orgId),
  })

  return NextResponse.json({ success: true, url: authUrl })
})
