import { NextResponse } from "next/server"
import crypto from "crypto"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"
import { getTenantInstagramLoginApp, getPinnedMetaApp } from "@/lib/social/tenant-meta-app"
import { normalizeOAuthReturnKey } from "@/lib/social/oauth-return"

/**
 * Start the Instagram-Login OAuth flow ("Path B").
 *
 * SEPARATE from the Facebook-Login flow (oauth/facebook/start). Meta retired Instagram DM messaging on
 * the Facebook-Login page-token path — it returns "(#3) Application does not have the capability" on
 * /conversations and never delivers live IG webhooks. Instagram Direct now lives on the
 * "Instagram API with Instagram Login" surface: a dedicated Instagram app, api.instagram.com auth,
 * graph.instagram.com tokens, and the instagram_business_manage_messages scope.
 *
 * Required env:
 *   INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI
 *   (INSTAGRAM_APP_ID = the dedicated IG app, NOT the Facebook app id.)
 *
 * Multi-tenant: orgId + CSRF state travel in a signed cookie AND the OAuth `state` param (Instagram
 * echoes it back to the callback on any host), mirroring the Facebook flow so tenant subdomains work.
 */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const GET = withSocialConnectAuth("write", async (req, auth) => {
  const orgId = auth.orgId
  // Opt-in return target — a whitelisted KEY, never a path (see lib/social/oauth-return.ts).
  const returnKey = normalizeOAuthReturnKey(new URL(req.url).searchParams.get("from"))

  // Model B: prefer the tenant's OWN Instagram-Login app (from their igLogin ChannelConfig); fall back
  // to env (LeadDrive's shared IG-Login app). The redirect URI is always the shared LeadDrive callback —
  // each tenant registers it in their own IG app, and the callback resolves the org from the signed state.
  // `?app=<channelConfigId>` PINS this flow to one specific Instagram-Login app row (the App Review
  // staging path), with NO env fallback — see getPinnedMetaApp. Absent, nothing changes below.
  const pinnedConfigId = new URL(req.url).searchParams.get("app")?.trim() || null
  const pinnedApp = pinnedConfigId ? await getPinnedMetaApp(orgId, pinnedConfigId, "instagram-login") : null
  if (pinnedConfigId && !pinnedApp) {
    return NextResponse.json(
      { error: "That Meta app configuration is not usable for an Instagram-Login connection. It must belong to this workspace, be an Instagram-Login row, and carry App ID, App Secret and verify token." },
      { status: 400 },
    )
  }

  const tenantApp = pinnedApp ? null : await getTenantInstagramLoginApp(orgId)
  const appId = pinnedApp?.appId || tenantApp?.appId || process.env.INSTAGRAM_APP_ID
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI
  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "Instagram OAuth is not configured. Enter your Instagram-Login App ID + Secret on the channel, or set INSTAGRAM_APP_ID/INSTAGRAM_REDIRECT_URI." },
      { status: 500 },
    )
  }

  const state = base64url(crypto.randomBytes(16))
  // Without ?from and ?app the payload is byte-for-byte the historical one. `app` carries the pinned
  // config id to the callback inside the HMAC-signed payload, so the app that issued the code is
  // always the app whose secret redeems it (mirrors oauth/facebook/start).
  const payloadFields: Record<string, unknown> = { orgId, state, ts: Date.now() }
  if (returnKey) payloadFields.ret = returnKey
  if (pinnedApp) payloadFields.app = pinnedApp.configId
  const payload = JSON.stringify(payloadFields)
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  const signedState = Buffer.from(payload + "." + sig).toString("base64url")

  // Instagram-Login scopes. These must be added under Use Cases > "Manage messages and content in
  // Instagram" > API setup with Instagram login > Permissions, else the consent dialog drops them.
  // instagram_business_basic = profile/account; instagram_business_manage_messages = read+reply DMs.
  const scopes = [
    "instagram_business_basic",
    "instagram_business_manage_messages",
  ].join(",")

  const url = new URL("https://api.instagram.com/oauth/authorize")
  url.searchParams.set("client_id", appId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", scopes)
  url.searchParams.set("state", signedState)

  const res = NextResponse.redirect(url.toString())
  res.cookies.set("ld_ig_oauth", signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1800, // 30 min — consent (account picker + permission review) can exceed 10 min
    path: "/",
  })
  return res
})
