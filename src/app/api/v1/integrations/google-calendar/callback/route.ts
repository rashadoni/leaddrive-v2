import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"
import crypto from "node:crypto"
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

    // Upsert: update existing or create new Account record for google-calendar
    const existing = await runWithRlsBypass(() => prisma.account.findFirst({
      where: { userId, provider: "google-calendar" },
    }))

    if (existing) {
      await runWithRlsBypass(() => prisma.account.update({
        where: { id: existing.id },
        data: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || existing.refresh_token,
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
          token_type: tokens.token_type || "Bearer",
          scope: tokens.scope || "https://www.googleapis.com/auth/calendar.events",
        },
      }))
    } else {
      await runWithRlsBypass(() => prisma.account.create({
        data: {
          userId,
          type: "oauth",
          provider: "google-calendar",
          providerAccountId: `gcal-${userId}`,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
          token_type: tokens.token_type || "Bearer",
          scope: tokens.scope || "https://www.googleapis.com/auth/calendar.events",
        },
      }))
    }

    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=success`)
  } catch (err) {
    console.error("[Google Calendar] OAuth callback error:", err)
    return NextResponse.redirect(`${appUrl}/settings/integrations?gcal=error&reason=token_exchange`)
  }
}
