import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { encryptToken, decryptToken } from "@/lib/secure-token"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

/**
 * X (Twitter) OAuth 2.0 callback.
 * Exchanges the code for an access token + refresh token and stores them on a SocialAccount.
 */

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
  if (!code || !state) return redirectError(req, "missing_code")

  // Accept the signed state from the cookie (same-host) OR the `state` query param (X echoes it
  // back on ANY host — survives tenant subdomains where the cookie host ≠ TWITTER_REDIRECT_URI host).
  // When both are present they must be identical (CSRF cross-check); the HMAC below guards integrity.
  const cookieVal = req.cookies.get("ld_tw_oauth")?.value
  if (cookieVal && cookieVal !== state) return redirectError(req, "state_mismatch")
  const signedState = cookieVal || state

  const [payloadStr, sig] = Buffer.from(signedState, "base64url").toString("utf8").split(".")
  if (!payloadStr || !sig) return redirectError(req, "bad_cookie")
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadStr).digest("hex")
  const a = Buffer.from(expectedSig)
  const b = Buffer.from(sig)
  if (a.length !== b.length) return redirectError(req, "bad_signature")
  try {
    if (!crypto.timingSafeEqual(a, b)) return redirectError(req, "bad_signature")
  } catch {
    return redirectError(req, "bad_signature")
  }
  let payload: { orgId: string; state: string; v: string; ts: number }
  try {
    payload = JSON.parse(payloadStr)
  } catch {
    return redirectError(req, "bad_cookie")
  }
  if (Date.now() - payload.ts > 30 * 60 * 1000) return redirectError(req, "expired") // 30-min window

  // CSRF: the cookie-less (param-only) path carries NO proof the OAuth started in this session, so a
  // MATCHING session is REQUIRED — else a logged-out user could be tricked into linking their X
  // profile to an attacker's org. When the cookie IS present it already cross-checked the state (soft
  // session guard only). Mirrors the TikTok/YouTube/Facebook/Instagram callbacks.
  const sessionOrg = await getOrgId(req)
  if (!cookieVal) {
    if (!sessionOrg) return redirectError(req, "no_session")
    if (sessionOrg !== payload.orgId) return redirectError(req, "org_mismatch")
  } else if (sessionOrg && sessionOrg !== payload.orgId) {
    return redirectError(req, "org_mismatch")
  }

  // orgId is cryptographically verified from the signed state above. Run the
  // token exchange + users/me fetch + SocialAccount upsert + cookie cleanup under tenant
  // context so the reads/writes are RLS-scoped (prod no-op while RLS OFF).
  return runWithTenant(payload.orgId, async () => {
  const clientId = process.env.TWITTER_CLIENT_ID
  const clientSecret = process.env.TWITTER_CLIENT_SECRET
  const redirectUri = process.env.TWITTER_REDIRECT_URI
  // The client secret is REQUIRED (confidential client): the PKCE verifier travels
  // encrypted inside the state param, so Basic auth is the hard gate that makes a
  // leaked callback URL (code + state) useless on its own.
  if (!clientId || !clientSecret || !redirectUri) return redirectError(req, "not_configured")

  // Decrypt the PKCE verifier minted by the start route (AES-GCM, purpose-bound).
  let verifier: string
  try {
    verifier = decryptToken(payload.v || "", "oauth:twitter:pkce")
  } catch {
    return redirectError(req, "bad_cookie")
  }
  if (!verifier) return redirectError(req, "bad_cookie")

  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  })
  if (!tokenRes.ok) {
    console.error("[twitter-oauth] token exchange failed:", await tokenRes.text())
    return redirectError(req, "token_exchange_failed")
  }
  const tokenJson = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }

  // Fetch the authenticated user to get handle
  const userRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })
  const userJson = await userRes.json().catch(() => null) as { data?: { id: string; username: string; name: string } } | null
  const handle = userJson?.data?.username || "twitter_user"
  const displayName = userJson?.data?.name || handle

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000)
    : null

  // Store encoded tokens (access + refresh separated by ::) — encrypted at rest
  const storedToken = encryptToken(
    [tokenJson.access_token, tokenJson.refresh_token || ""].join("::"),
    "oauth:twitter",
  )

  await prisma.socialAccount.upsert({
    where: {
      organizationId_platform_handle: {
        organizationId: payload.orgId,
        platform: "twitter",
        handle,
      },
    },
    update: {
      accessToken: storedToken,
      tokenExpiresAt: expiresAt,
      displayName,
      isActive: true,
    },
    create: {
      organizationId: payload.orgId,
      platform: "twitter",
      handle,
      displayName,
      accessToken: storedToken,
      tokenExpiresAt: expiresAt,
      isActive: true,
    },
  })
  await compileOrganizationSourceRoutePlans(payload.orgId)

  const res = NextResponse.redirect(publicUrl(req, "/social-monitoring?connected=twitter"))
  res.cookies.delete("ld_tw_oauth")
  return res
  })
}

function redirectError(req: NextRequest, code: string): NextResponse {
  return NextResponse.redirect(publicUrl(req, `/social-monitoring?error=${code}`))
}
