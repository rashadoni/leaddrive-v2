import { NextResponse } from "next/server"
import crypto from "crypto"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"

/**
 * TikTok Login Kit — OAuth 2.0 with CSRF state.
 * Requires env: TIKTOK_CLIENT_KEY, TIKTOK_REDIRECT_URI.
 * Scopes: user.info.basic + video.list (for own account).
 * NOTE: TikTok's public API does NOT support cross-account mention search.
 *       What we can poll is the connected user's own videos and their comments.
 *
 * Multi-tenant: the signed orgId+CSRF payload travels in the OAuth `state` param
 * (TikTok echoes it back to the callback on ANY host) AND in a cookie — mirroring
 * the Facebook/Instagram flows. The callback accepts either, so the flow survives
 * tenant subdomains where the cookie host (e.g. brandprotection.leaddrivecrm.org)
 * differs from the single fixed TIKTOK_REDIRECT_URI host (app.leaddrivecrm.org).
 * A cookie-only `state` (the old behaviour) caused `missing_cookie` on subdomains.
 */

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const GET = withSocialConnectAuth("write", async (_req, auth) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  if (!clientKey || !redirectUri) {
    return NextResponse.json(
      { error: "TikTok OAuth not configured. Set TIKTOK_CLIENT_KEY and TIKTOK_REDIRECT_URI." },
      { status: 500 },
    )
  }

  const state = base64url(crypto.randomBytes(16))
  const payload = JSON.stringify({ orgId: auth.orgId, state, ts: Date.now() })
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  // Carry the SIGNED payload (not the raw nonce) in the OAuth `state` param so the
  // callback can recover it even when the cookie is dropped cross-subdomain.
  const signedState = Buffer.from(payload + "." + sig).toString("base64url")

  const url = new URL("https://www.tiktok.com/v2/auth/authorize/")
  url.searchParams.set("client_key", clientKey)
  url.searchParams.set("scope", "user.info.basic,video.list")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", signedState)

  const res = NextResponse.redirect(url.toString())
  res.cookies.set("ld_tt_oauth", signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1800, // 30 min — consent (login + permission review) can exceed 10 min
    path: "/",
  })
  return res
})
