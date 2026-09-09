import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { encryptToken } from "@/lib/secure-token"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

/**
 * Build an absolute URL pointing at the *public* host (app.leaddrivecrm.org),
 * not the internal upstream (0.0.0.0:3001 behind nginx) that `req.url` exposes —
 * otherwise redirects land on `localhost:3001` and the browser 500s/SSL-errors.
 */
function publicUrl(req: NextRequest, path: string): URL {
  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "app.leaddrivecrm.org"
  return new URL(path, `${proto}://${host}`)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  if (!code || !state) return errRedirect(req, "missing_code")

  // Accept the signed state from the cookie (same-host) OR the `state` query param (Google echoes it
  // back on ANY host — survives tenant subdomains where the cookie host ≠ YOUTUBE_REDIRECT_URI host).
  // When both are present they must be identical (CSRF cross-check); the HMAC below guards integrity.
  const cookieVal = req.cookies.get("ld_yt_oauth")?.value
  if (cookieVal && cookieVal !== state) return errRedirect(req, "state_mismatch")
  const signedState = cookieVal || state

  const [payloadStr, sig] = Buffer.from(signedState, "base64url").toString("utf8").split(".")
  if (!payloadStr || !sig) return errRedirect(req, "bad_cookie")
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const expected = crypto.createHmac("sha256", secret).update(payloadStr).digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  if (a.length !== b.length) return errRedirect(req, "bad_signature")
  try {
    if (!crypto.timingSafeEqual(a, b)) return errRedirect(req, "bad_signature")
  } catch {
    return errRedirect(req, "bad_signature")
  }
  const payload = JSON.parse(payloadStr) as { orgId: string; state: string; ts: number }
  if (Date.now() - payload.ts > 30 * 60 * 1000) return errRedirect(req, "expired") // 30-min window

  // CSRF: the cookie-less (param-only) path carries NO proof the OAuth started in this session, so a
  // MATCHING session is REQUIRED — else a logged-out user could be tricked into linking their YouTube
  // channel to an attacker's org. When the cookie IS present it already cross-checked the state (soft
  // session guard only). Mirrors the TikTok/Facebook/Instagram callbacks.
  const sessionOrg = await getOrgId(req)
  if (!cookieVal) {
    if (!sessionOrg) return errRedirect(req, "no_session")
    if (sessionOrg !== payload.orgId) return errRedirect(req, "org_mismatch")
  } else if (sessionOrg && sessionOrg !== payload.orgId) {
    return errRedirect(req, "org_mismatch")
  }

  // orgId is cryptographically verified from the signed state above. Run the
  // token exchange + channel fetch + SocialAccount upsert under tenant context
  // so the write is RLS-scoped (prod no-op while RLS OFF).
  return runWithTenant(payload.orgId, async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return errRedirect(req, "not_configured")

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  })
  if (!tokenRes.ok) return errRedirect(req, "token_exchange_failed")
  const t = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number }

  // Fetch channel info
  const chanRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${t.access_token}` },
  })
  const chan = (await chanRes.json().catch(() => null)) as { items?: Array<{ id: string; snippet: { title: string; customUrl?: string } }> } | null
  const channel = chan?.items?.[0]
  // YouTube Data API requires a channel ID (UC...) for `allThreadsRelatedToChannelId`.
  // The vanity/customUrl is NOT accepted. Store the channel ID in `handle`,
  // keep the customUrl / title in `displayName`.
  const handle = channel?.id || "youtube_channel"
  const displayName = channel?.snippet.title || channel?.snippet.customUrl || handle

  const stored = encryptToken([t.access_token, t.refresh_token || ""].join("::"), "oauth:youtube")
  const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null

  await prisma.socialAccount.upsert({
    where: { organizationId_platform_handle: { organizationId: payload.orgId, platform: "youtube", handle } },
    update: {
      accessToken: stored,
      tokenExpiresAt: expiresAt,
      displayName,
      isActive: true,
      // A reconnect can change the Google account or granted scopes. Require a
      // fresh sandbox proof before this credential may publish again.
      outboundLiveEnabled: false,
      outboundEmergencyStopped: true,
      outboundCapability: null,
      outboundVerifiedAt: null,
    },
    create: {
      organizationId: payload.orgId,
      platform: "youtube",
      handle,
      displayName,
      accessToken: stored,
      tokenExpiresAt: expiresAt,
      isActive: true,
    },
  })
  await compileOrganizationSourceRoutePlans(payload.orgId)

  const res = NextResponse.redirect(publicUrl(req, "/social-monitoring?connected=youtube"))
  res.cookies.delete("ld_yt_oauth")
  return res
  })
}

function errRedirect(req: NextRequest, code: string): NextResponse {
  return NextResponse.redirect(publicUrl(req, `/social-monitoring?error=${code}`))
}
