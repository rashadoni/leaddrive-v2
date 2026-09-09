import { NextResponse } from "next/server"
import crypto from "crypto"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"

/**
 * YouTube / Google OAuth 2.0 start.
 * Requires env: GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI (YouTube variant),
 * scope: https://www.googleapis.com/auth/youtube.force-ssl (read + approved replies).
 *
 * Multi-tenant: the signed orgId+CSRF payload travels in the OAuth `state`
 * param (Google echoes it back to the callback on ANY host) AND in a cookie —
 * mirroring the TikTok/Facebook/Instagram flows (#257). The callback accepts
 * either, so the flow survives tenant subdomains where the cookie host (e.g.
 * brandprotection.leaddrivecrm.org) differs from the single fixed
 * YOUTUBE_REDIRECT_URI host (app.leaddrivecrm.org). A cookie-only `state`
 * (the old behaviour) caused `missing_cookie` on subdomains.
 */

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const GET = withSocialConnectAuth("write", async (_req, auth) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "YouTube OAuth not configured. Set GOOGLE_CLIENT_ID and YOUTUBE_REDIRECT_URI." },
      { status: 500 },
    )
  }

  const state = base64url(crypto.randomBytes(16))
  const payload = JSON.stringify({ orgId: auth.orgId, state, ts: Date.now() })
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  // Carry the SIGNED payload (not the raw nonce) in the OAuth `state` param so
  // the callback can recover it even when the cookie is dropped cross-subdomain.
  const signedState = Buffer.from(payload + "." + sig).toString("base64url")

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.force-ssl")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("state", signedState)

  const res = NextResponse.redirect(url.toString())
  res.cookies.set("ld_yt_oauth", signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1800, // 30 min — consent (login + permission review) can exceed 10 min
    path: "/",
  })
  return res
})
