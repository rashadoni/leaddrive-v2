import { NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"
import { getTenantMetaApp } from "@/lib/social/tenant-meta-app"
import { normalizeOAuthReturnKey } from "@/lib/social/oauth-return"

/**
 * Start Facebook (Meta Graph) OAuth flow. The same token covers Instagram
 * Business/Creator accounts linked to the page, so one flow serves both.
 *
 * Required env:
 *   FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_REDIRECT_URI
 *
 * Multi-tenant: orgId + state travel in a signed cookie; the single redirect
 * URI in the Meta App dashboard is shared by every tenant.
 */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const GET = withSocialConnectAuth("write", async (req, auth) => {
  const orgId = auth.orgId
  // Opt-in "where to come back to" — a WHITELISTED KEY, never a path (see lib/social/oauth-return.ts:
  // the callback resolves redirects with new URL(path, origin), so accepting a path would be an open
  // redirect). Absent/unknown => null => the historical /social-monitoring destination.
  const returnKey = normalizeOAuthReturnKey(new URL(req.url).searchParams.get("from"))

  // Model B (per-tenant Meta app): prefer the tenant's own appId from their FB/IG ChannelConfig.
  // Fall back to env (LeadDrive's own shared app) for backward compat. The redirect URI is always
  // the shared LeadDrive callback — each tenant registers it in their own Meta app's OAuth settings,
  // and the callback resolves the org from the signed `state` (so one URI serves every tenant).
  const tenantApp = await getTenantMetaApp(orgId)
  const appId = tenantApp?.appId || process.env.FACEBOOK_APP_ID
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI
  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "Facebook OAuth is not configured. Enter your Meta App ID + Secret on the Facebook channel, or set FACEBOOK_APP_ID/FACEBOOK_REDIRECT_URI." },
      { status: 500 },
    )
  }

  const state = base64url(crypto.randomBytes(16))
  // Without ?from the payload stays byte-for-byte what it always was, so the signed-state shape
  // (and every flow that depends on it) is untouched for the existing entry points.
  const payload = JSON.stringify(
    returnKey ? { orgId, state, ts: Date.now(), ret: returnKey } : { orgId, state, ts: Date.now() },
  )
  const secret = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  // Carry the signed payload in the OAuth `state` param (FB echoes it back to the callback on ANY
  // host) AND in a cookie. The callback accepts either — so the flow survives tenant subdomains where
  // the cookie host differs from the fixed FACEBOOK_REDIRECT_URI host (was causing `missing_cookie`).
  const signedState = Buffer.from(payload + "." + sig).toString("base64url")

  // Scopes must be enabled in the Meta App's Use Cases > Permissions tab first.
  // - pages_read_user_content: comments on our posts + /tagged (visitor content)
  // - instagram_manage_comments: comments on IG media + /tags (brand mentions)
  const monitoringScopes = [
    "public_profile",
    "pages_show_list",
    "pages_read_engagement",
    "pages_read_user_content",
    "business_management",
    "instagram_basic",
    "instagram_manage_comments",
  ]
  // Inbox DMs (omni-channel): read/send Messenger + IG Direct, and subscribe the Page to the
  // `messages` webhook (subscribed_apps). All three require Meta App Review for production; in Dev
  // mode they work for the app's own admined pages, and must be enabled in the Meta App's Use Cases
  // > Permissions — else Facebook drops them and the dialog returns without a `code`. Request them
  // ONLY for tenants that actually run the FB/IG inbox (they already have a ChannelConfig for it);
  // monitoring-only tenants (e.g. Brand Protection) get the smaller, always-grantable set so the
  // reconnect isn't broken by a permission their Meta app has never enabled.
  const inboxScopes = ["pages_messaging", "pages_manage_metadata", "instagram_manage_messages"]
  // Starting from the Channels screen IS the inbox intent, and on a FIRST one-click connect there is
  // no ChannelConfig yet — without this the flow would request monitoring scopes only, the callback's
  // subscribePageToMessages would fail on permissions, and the user would see a green "connected"
  // channel whose inbox never receives a single DM.
  const usesSocialInbox = Boolean(returnKey) || (await prisma.channelConfig.count({
    where: { organizationId: orgId, channelType: { in: ["facebook", "instagram"] }, isActive: true },
  })) > 0
  const scopes = [...monitoringScopes, ...(usesSocialInbox ? inboxScopes : [])].join(",")

  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth")
  url.searchParams.set("client_id", appId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", signedState)
  url.searchParams.set("scope", scopes)
  url.searchParams.set("response_type", "code")

  const res = NextResponse.redirect(url.toString())
  res.cookies.set("ld_fb_oauth", signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1800, // 30 min — the OAuth consent (page picker + permission review + Meta App setup) can
                  // easily exceed 10 min during onboarding; a short window caused `missing_cookie`.
    path: "/",
  })
  return res
})
