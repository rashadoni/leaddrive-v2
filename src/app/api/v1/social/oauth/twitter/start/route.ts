import { NextResponse } from "next/server"
import crypto from "crypto"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"
import { encryptToken } from "@/lib/secure-token"

/**
 * Start X (Twitter) OAuth 2.0 Authorization Code flow with PKCE.
 * Requires env vars: TWITTER_CLIENT_ID, TWITTER_REDIRECT_URI.
 *
 * The HMAC-signed payload {orgId, state, v, ts} travels BOTH in the
 * `state` param (X echoes it back on any host — survives tenant subdomains
 * where the cookie host ≠ the fixed TWITTER_REDIRECT_URI host) AND in a
 * short-lived cookie (same-host CSRF proof). Mirrors the TikTok/YouTube fix.
 *
 * `v` is the PKCE code_verifier encrypted with AES-GCM (not just signed):
 * the state param is visible in URLs (history, access logs, referrers), and a
 * plaintext verifier there would hand code+verifier to anyone who sees the
 * callback URL, defeating PKCE's code-interception protection.
 */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const GET = withSocialConnectAuth("write", async (_req, auth) => {
  const orgId = auth.orgId

  const clientId = process.env.TWITTER_CLIENT_ID
  const redirectUri = process.env.TWITTER_REDIRECT_URI
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "X (Twitter) OAuth is not configured. Set TWITTER_CLIENT_ID and TWITTER_REDIRECT_URI." },
      { status: 500 },
    )
  }

  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))

  const payload = JSON.stringify({ orgId, state, v: encryptToken(verifier, "oauth:twitter:pkce"), ts: Date.now() })
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  const signedState = Buffer.from(payload + "." + sig).toString("base64url")

  const url = new URL("https://x.com/i/oauth2/authorize")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", "tweet.read users.read offline.access")
  url.searchParams.set("state", signedState)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")

  const res = NextResponse.redirect(url.toString())
  res.cookies.set("ld_tw_oauth", signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1800, // 30 min — matches the callback's expiry window
    path: "/",
  })
  return res
})
