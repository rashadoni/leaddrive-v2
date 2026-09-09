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

  // Accept the signed state from the cookie (same-host) OR the `state` query param (TikTok echoes it
  // back on ANY host — survives tenant subdomains where the cookie host ≠ TIKTOK_REDIRECT_URI host).
  // When both are present they must be identical (CSRF cross-check); the HMAC below guards integrity.
  const cookieVal = req.cookies.get("ld_tt_oauth")?.value
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
  // MATCHING session is REQUIRED — else a logged-out user could be tricked into linking their TikTok
  // to an attacker's org. When the cookie IS present it already cross-checked the state (soft session
  // guard only). Mirrors the Facebook/Instagram callbacks.
  const sessionOrg = await getOrgId(req)
  if (!cookieVal) {
    if (!sessionOrg) return errRedirect(req, "no_session")
    if (sessionOrg !== payload.orgId) return errRedirect(req, "org_mismatch")
  } else if (sessionOrg && sessionOrg !== payload.orgId) {
    return errRedirect(req, "org_mismatch")
  }

  // orgId is cryptographically verified from the signed state above. Run the
  // token exchange + user-info fetch + SocialAccount upsert under tenant context
  // so the writes/reads are RLS-scoped (prod no-op while RLS OFF).
  return runWithTenant(payload.orgId, async () => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  if (!clientKey || !clientSecret || !redirectUri) return errRedirect(req, "not_configured")

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  })
  if (!tokenRes.ok) return errRedirect(req, "token_exchange_failed")
  const tokenJson = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    open_id?: string
  }

  // Fetch user info. Request ONLY fields covered by the user.info.basic scope
  // (open_id / union_id / avatar_url / display_name): the `username` field
  // needs the separate user.info.profile scope, and asking for it without that
  // scope makes TikTok reject the WHOLE request with scope_not_authorized —
  // which is why connected accounts used to display the raw open_id.
  const userRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })
  const userJson = (await userRes.json().catch(() => null)) as { data?: { user?: { display_name?: string } } } | null
  // open_id is the stable per-user key (display_name is mutable) — keep it as
  // the upsert handle so reconnects update the same row.
  const handle = tokenJson.open_id || "tiktok_user"
  const displayName = userJson?.data?.user?.display_name || handle

  const stored = encryptToken(
    [tokenJson.access_token, tokenJson.refresh_token || ""].join("::"),
    "oauth:tiktok",
  )
  const expiresAt = tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1000) : null

  await prisma.socialAccount.upsert({
    where: {
      organizationId_platform_handle: { organizationId: payload.orgId, platform: "tiktok", handle },
    },
    update: { accessToken: stored, tokenExpiresAt: expiresAt, displayName, isActive: true },
    create: {
      organizationId: payload.orgId,
      platform: "tiktok",
      handle,
      displayName,
      accessToken: stored,
      tokenExpiresAt: expiresAt,
      isActive: true,
    },
  })
  await compileOrganizationSourceRoutePlans(payload.orgId)

  const res = NextResponse.redirect(publicUrl(req, "/social-monitoring?connected=tiktok"))
  res.cookies.delete("ld_tt_oauth")
  return res
  })
}

function errRedirect(req: NextRequest, code: string): NextResponse {
  return NextResponse.redirect(publicUrl(req, `/social-monitoring?error=${code}`))
}
