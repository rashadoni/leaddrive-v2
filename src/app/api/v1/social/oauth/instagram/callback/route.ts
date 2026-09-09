import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { getTenantInstagramLoginApp } from "@/lib/social/tenant-meta-app"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"
import { normalizeOAuthReturnKey, oauthReturnUrl } from "@/lib/social/oauth-return"

const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
const IG_GRAPH = "https://graph.instagram.com"

// The short-token endpoint historically returned { access_token, user_id }; newer Instagram-Login
// returns the same fields, occasionally wrapped in a `data` array. Accept both shapes.
interface ShortTokenJson {
  access_token?: string
  user_id?: string | number
  permissions?: string[]
  data?: Array<{ access_token: string; user_id: string | number; permissions?: string[] }>
  error_type?: string
  error_message?: string
}
interface LongTokenJson { access_token: string; token_type?: string; expires_in?: number }

function publicUrl(req: NextRequest, path: string): URL {
  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "app.leaddrivecrm.org"
  return new URL(path, `${proto}://${host}`)
}
function redirectError(req: NextRequest, code: string, ret?: string | null): NextResponse {
  // `ret` omitted => /social-monitoring, exactly as before.
  return NextResponse.redirect(publicUrl(req, oauthReturnUrl(ret, { error: code })))
}

function graphBearerInit(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } }
}

async function redactedProviderText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return redactOAuthProviderText(text)
}

/**
 * Instagram-Login OAuth callback ("Path B" — "Instagram API with Instagram Login").
 *
 * Flow:
 *  1. Verify the signed state (orgId + CSRF) — same scheme as the Facebook flow.
 *  2. Exchange `code` -> short-lived Instagram User token (POST api.instagram.com/oauth/access_token).
 *  3. Exchange short -> long-lived token (~60d) (GET graph.instagram.com/access_token ig_exchange_token).
 *  4. GET /me -> IG user id + username.
 *  5. Upsert ChannelConfig(instagram) holding the IG-Login token (settings.igLogin=true) so the inbox
 *     webhook + reply path can use it, distinct from any legacy Facebook-Login page-token row.
 *     No SocialAccount(instagram) row is written here (see the step-5 note in the body for why).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  if (searchParams.get("error")) return redirectError(req, "ig_denied")
  if (!code || !state) return redirectError(req, "missing_code")

  // Accept the signed state from the cookie (same-host) OR the `state` param (IG echoes it on any host).
  const cookieVal = req.cookies.get("ld_ig_oauth")?.value
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
  const payload = JSON.parse(payloadStr) as { orgId: string; state: string; ts: number; ret?: string }
  // Trusted only from here on — the HMAC was just verified. Branches above keep the static default.
  const ret = normalizeOAuthReturnKey(payload.ret)
  if (Date.now() - payload.ts > 30 * 60 * 1000) return redirectError(req, "expired", ret)

  // CSRF: the cookie-less (param-only) path gives no CSRF proof, so require a MATCHING session — else a
  // logged-out user could be tricked into linking their IG to an attacker's org (same guard as FB flow).
  const sessionOrg = await getOrgId(req)
  if (!cookieVal) {
    if (!sessionOrg) return redirectError(req, "no_session", ret)
    if (sessionOrg !== payload.orgId) return redirectError(req, "org_mismatch", ret)
  } else if (sessionOrg && sessionOrg !== payload.orgId) {
    return redirectError(req, "org_mismatch", ret)
  }

  // orgId is cryptographically verified from the signed state above. Run the
  // tenant-app read + ChannelConfig upsert under tenant context so the writes/reads
  // are RLS-scoped (prod no-op while RLS OFF). Redirect semantics preserved.
  return runWithTenant(payload.orgId, async () => {
  // Model B: use the SAME IG-Login app the start route used — the tenant's own appId/appSecret (resolved
  // by the signed-state orgId), with env fallback to LeadDrive's shared IG-Login app. appSecret is read
  // server-side only (token exchange below).
  const tenantApp = await getTenantInstagramLoginApp(payload.orgId)
  const appId = tenantApp?.appId || process.env.INSTAGRAM_APP_ID
  const appSecret = tenantApp?.appSecret || process.env.INSTAGRAM_APP_SECRET
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI
  if (!appId || !appSecret || !redirectUri) return redirectError(req, "not_configured", ret)

  // 1) short-lived Instagram User token (form-encoded POST)
  const form = new URLSearchParams()
  form.set("client_id", appId)
  form.set("client_secret", appSecret)
  form.set("grant_type", "authorization_code")
  form.set("redirect_uri", redirectUri)
  form.set("code", code)
  const shortRes = await fetch(IG_TOKEN_URL, { method: "POST", body: form })
  if (!shortRes.ok) {
    console.error("[instagram-oauth] short token failed:", await redactedProviderText(shortRes))
    return redirectError(req, "token_exchange_failed", ret)
  }
  const shortJson = await shortRes.json() as ShortTokenJson
  const short = shortJson.access_token || shortJson.data?.[0]?.access_token
  const shortUserId = String(shortJson.user_id ?? shortJson.data?.[0]?.user_id ?? "")
  if (!short) {
    console.error("[instagram-oauth] no short token in response:", JSON.stringify(shortJson))
    return redirectError(req, "token_exchange_failed", ret)
  }

  // 2) long-lived token (~60 days)
  const longRes = await fetch(
    `${IG_GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(short)}`,
  )
  if (!longRes.ok) {
    console.error("[instagram-oauth] long token failed:", await redactedProviderText(longRes))
    return redirectError(req, "long_token_failed", ret)
  }
  const longJson = await longRes.json() as LongTokenJson
  const longToken = longJson.access_token
  if (!longToken) return redirectError(req, "long_token_failed", ret)
  const expiresAt = longJson.expires_in ? Date.now() + longJson.expires_in * 1000 : null

  // 3) IG user profile (id + username)
  let username = ""
  let userId = shortUserId
  try {
    const meRes = await fetch(`${IG_GRAPH}/me?fields=user_id,username`, graphBearerInit(longToken))
    if (meRes.ok) {
      const me = await meRes.json() as { user_id?: string | number; username?: string; id?: string }
      userId = String(me.user_id ?? me.id ?? shortUserId)
      username = me.username || ""
    }
  } catch {
    /* non-fatal — fall back to the id from the token exchange */
  }
  if (!userId) return redirectError(req, "no_ig_user", ret)

  const displayName = username ? `@${username}` : `Instagram ${userId}`

  // 4) ChannelConfig(instagram) holding the IG-Login token. Keyed on (org, instagram, pageId=igUserId).
  //    settings.igLogin marks this as the Instagram-Login (Path B) row; the token is stored raw in
  //    apiKey to match the existing ChannelConfig send-path convention (see inbox-channel.ts).
  const existing = await prisma.channelConfig.findFirst({
    where: { organizationId: payload.orgId, channelType: "instagram", pageId: userId },
    select: { id: true, settings: true },
  })
  const prevSettings =
    existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
      ? (existing.settings as Record<string, unknown>)
      : {}
  const settings = { ...prevSettings, igLogin: true, tokenExpiresAt: expiresAt, username }
  if (existing) {
    await prisma.channelConfig.update({
      where: { id: existing.id },
      data: { apiKey: longToken, isActive: true, settings },
    })
  } else {
    await prisma.channelConfig.create({
      data: {
        organizationId: payload.orgId,
        channelType: "instagram",
        configName: displayName,
        pageId: userId,
        apiKey: longToken,
        // appId/appSecret are env-global for the single IG-Login app (read from env by the webhook +
        // token exchange) — not stored per-row.
        isActive: true,
        settings,
      },
    })
  }

  // 5) Intentionally NO SocialAccount(instagram) row. Social Monitoring's poll-all cron iterates
  //    SocialAccount(instagram) and polls graph.facebook.com/{handle}/media with a Facebook-page-token
  //    encryption AAD — an IG-Login user token can't serve that (wrong host + wrong AAD), so a row here
  //    would be a permanently-erroring poller entry. The inbox resolves IG DMs via ChannelConfig alone;
  //    IG comments/mentions stay on the Facebook-Login SocialAccount (created by the FB OAuth callback).
  //    (Architect review 2026-06-08 — fix-before-build.)

  const res = NextResponse.redirect(publicUrl(req, oauthReturnUrl(ret, { connected: "instagram", ig: "1" })))
  res.cookies.delete("ld_ig_oauth")
  return res
  })
}
