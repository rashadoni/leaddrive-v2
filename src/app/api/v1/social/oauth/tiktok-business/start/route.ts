import crypto from "crypto"
import { NextResponse } from "next/server"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"

const AUTH_HOSTS = new Set(["business-api.tiktok.com", "ads.tiktok.com", "www.tiktok.com"])

function signedState(organizationId: string): string {
  const payload = JSON.stringify({ orgId: organizationId, nonce: crypto.randomBytes(16).toString("base64url"), ts: Date.now() })
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  return Buffer.from(`${payload}.${signature}`).toString("base64url")
}

/**
 * TikTok Accounts API uses the account-holder authorization URL generated in
 * TikTok for Business > My Apps. It is not interchangeable with Login Kit.
 */
export const GET = withSocialConnectAuth("write", async (_request, auth) => {
  const authorizationUrl = process.env.TIKTOK_BUSINESS_AUTHORIZATION_URL?.trim()
  const redirectUri = process.env.TIKTOK_BUSINESS_REDIRECT_URI?.trim()
  if (!authorizationUrl || !redirectUri) {
    return NextResponse.json({ error: "TikTok Business OAuth is not configured. Set TIKTOK_BUSINESS_AUTHORIZATION_URL and TIKTOK_BUSINESS_REDIRECT_URI." }, { status: 500 })
  }
  let url: URL
  try { url = new URL(authorizationUrl) } catch {
    return NextResponse.json({ error: "TIKTOK_BUSINESS_AUTHORIZATION_URL is invalid." }, { status: 500 })
  }
  if (url.protocol !== "https:" || !AUTH_HOSTS.has(url.hostname.toLowerCase())) {
    return NextResponse.json({ error: "TIKTOK_BUSINESS_AUTHORIZATION_URL host is not allowed." }, { status: 500 })
  }
  const state = signedState(auth.orgId)
  url.searchParams.set("state", state)
  url.searchParams.set("redirect_uri", redirectUri)

  const response = NextResponse.redirect(url.toString())
  response.cookies.set("ld_tt_business_oauth", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1800,
    path: "/",
  })
  return response
})
