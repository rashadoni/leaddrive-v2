import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
// One API, not `import { google } from "googleapis"`: the root entry declares
// every Google API there is — 165 MB of typings for the type check to hold in
// memory, and 2.4 s of module loading against 0.3 s. The calendar module exports
// the same `auth` and `calendar`, so the calls below are unchanged.
import * as google from "googleapis/build/src/apis/calendar"
import crypto from "node:crypto"
import { replaceCalendarConnection } from "@/lib/google-calendar-connection"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

function readState(raw: string): { userId: string; orgId: string } | null {
  const [payload, signature] = raw.split(".")
  const secret = process.env.NEXTAUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || ""
  if (!payload || !signature || !secret) return null
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url")
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string; orgId?: string; exp?: number; nonce?: string }
    if (!value.userId || !value.orgId || !value.nonce || !value.exp || value.exp < Date.now()) return null
    return { userId: value.userId, orgId: value.orgId }
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const appUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"

  if (error) {
    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=${error}`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=missing_params`)
  }

  const verified = readState(state)
  if (!verified) return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=invalid_state`)
  const user = await runWithRlsBypass(() => prisma.user.findFirst({
    where: { id: verified.userId, organizationId: verified.orgId, isActive: true, organization: { isActive: true } },
    select: { id: true },
  }))
  if (!user) return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=invalid_state`)
  const userId = verified.userId

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=not_configured`)
  }

  const redirectUri = `${appUrl}/api/v1/integrations/google-calendar/callback`
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

  try {
    const { tokens } = await oauth2Client.getToken(code)

    oauth2Client.setCredentials(tokens)
    const identity = await google.calendar({ version: "v3", auth: oauth2Client }).calendars.get({ calendarId: "primary", fields: "id" }, { timeout: 8000 })
    if (!identity.data.id) throw new Error("CALENDAR_IDENTITY_MISSING")
    const calendarId = identity.data.id
    await runWithRlsBypass(() => prisma.$transaction((tx: Prisma.TransactionClient) =>
      replaceCalendarConnection(tx, verified.orgId, userId, tokens, calendarId),
    ))

    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=success`)
  } catch {
    console.error("[Google Calendar] OAuth callback failed", { code: "CALENDAR_CONNECT_FAILED" })
    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=token_exchange`)
  }
}
