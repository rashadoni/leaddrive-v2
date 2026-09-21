import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { encryptToken } from "@/lib/secure-token"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { getTenantMetaApp, getPinnedMetaApp } from "@/lib/social/tenant-meta-app"
import { enumerateGrantedPages } from "@/lib/social/meta-granted-assets"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"
import {
  normalizeOAuthReturnKey,
  oauthReturnChannelType,
  oauthReturnUrl,
  pickOAuthReturnChannelId,
} from "@/lib/social/oauth-return"
import { resolveOAuthReturnChannel } from "@/lib/social/oauth-return-channel"

const GRAPH = "https://graph.facebook.com/v21.0"

interface TokenJson { access_token: string; token_type?: string; expires_in?: number }
interface Page {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id: string }
}

/**
 * Build an absolute URL that points to the *public* host (app.leaddrivecrm.org),
 * not the internal upstream (0.0.0.0:3001) that req.url exposes behind nginx.
 */
function publicUrl(req: NextRequest, path: string): URL {
  const proto = req.headers.get("x-forwarded-proto") || "https"
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "app.leaddrivecrm.org"
  return new URL(path, `${proto}://${host}`)
}

function graphBearerInit(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } }
}

async function redactedProviderText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  return redactOAuthProviderText(text)
}

/**
 * Facebook (Meta Graph) OAuth callback.
 *
 * Flow:
 *  1. Verify state cookie (multi-tenant orgId + CSRF guard).
 *  2. Exchange `code` for a short-lived user access token.
 *  3. Exchange short-lived for a long-lived user token (~60 days).
 *  4. GET /me/accounts — returns every Page the user admins, each with its
 *     own long-lived Page access token (these don't expire as long as the
 *     user keeps admin access).
 *  5. Upsert one SocialAccount per Page. If the Page has a linked Instagram
 *     Business account, also upsert a SocialAccount for `instagram`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  // Facebook redirects back WITHOUT a `code` when it rejects the request (user
  // cancelled, or a requested scope isn't enabled/approved on the Meta app). It
  // carries the real reason in `error`/`error_reason`/`error_description` — surface
  // it instead of a blanket `missing_code`, so an operator can see exactly which
  // permission was refused. The value is redacted + length-capped before it lands
  // in the redirect query.
  if (!code) {
    const fbError = searchParams.get("error_description")
      || searchParams.get("error_reason")
      || searchParams.get("error")
    if (fbError) {
      const detail = redactOAuthProviderText(fbError).replace(/[\r\n]+/g, " ").slice(0, 200)
      return redirectError(req, `facebook_denied: ${detail}`)
    }
    return redirectError(req, "missing_code")
  }
  if (!state) return redirectError(req, "missing_code")

  // Accept the signed state from the cookie (same-host) OR the `state` query param (FB echoes it back
  // on ANY host — survives tenant subdomains where the cookie host ≠ FACEBOOK_REDIRECT_URI host).
  // When both are present they must be identical (CSRF cross-check). The payload signature (verified
  // below) guarantees integrity in either case.
  const cookieVal = req.cookies.get("ld_fb_oauth")?.value
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
  const payload = JSON.parse(payloadStr) as {
    orgId: string
    state: string
    ts: number
    ret?: string
    app?: string
    channelId?: unknown
  }
  // First point where the payload is HMAC-verified, so this is the first place `ret` may be trusted.
  // Re-normalising on the consuming side keeps the whitelist authoritative even if the issuing side
  // ever changes. Errors raised ABOVE this line must keep the static default — `ret` is unproven there.
  const ret = normalizeOAuthReturnKey(payload.ret)
  if (Date.now() - payload.ts > 30 * 60 * 1000) return redirectError(req, "expired", ret) // 30-min window
  // CSRF: the OAuth must finish in the SAME session that started it. The session cookie is
  // COOKIE_DOMAIN-scoped so it reaches the callback even cross-subdomain.
  //  - cookie-less (param-only) path: the cookie gave NO CSRF proof, so a MATCHING session is
  //    REQUIRED — else a logged-out Page admin could be tricked into linking their Page to an
  //    attacker's org (adversarial review #2).
  //  - cookie present: it already cross-checked the state; the session is a soft extra guard.
  const sessionOrg = await getOrgId(req)
  if (!cookieVal) {
    if (!sessionOrg) return redirectError(req, "no_session", ret)
    if (sessionOrg !== payload.orgId) return redirectError(req, "org_mismatch", ret)
  } else if (sessionOrg && sessionOrg !== payload.orgId) {
    return redirectError(req, "org_mismatch", ret)
  }

  // orgId is cryptographically verified from the signed state above. Run the
  // tenant-Meta-app read + all SocialAccount upserts + inbox-channel wiring under
  // tenant context so the writes/reads are RLS-scoped (prod no-op while RLS OFF).
  return runWithTenant(payload.orgId, async () => {
  // Model B (per-tenant Meta app): use the SAME app the start route used — the tenant's own
  // appId/appSecret from their FB/IG ChannelConfig (resolved by the signed-state orgId), with env
  // fallback to LeadDrive's shared app. appSecret is read server-side only (token exchange below).
  // A PINNED flow (`?app=<channelConfigId>` on the start route) names its Meta app inside the signed
  // state. Honour that id instead of re-running the org-wide `updatedAt DESC` lookup: the app that
  // issued this code is the only app whose secret can redeem it, and on a tenant holding several Meta
  // apps the org-wide lookup can legitimately return a different row than the start route saw. No env
  // fallback on this path — a pinned flow that cannot resolve its app must fail, not silently swap in
  // the shared production app.
  const pinnedApp = payload.app ? await getPinnedMetaApp(payload.orgId, payload.app, "facebook") : null
  if (payload.app && !pinnedApp) return redirectError(req, "not_configured", ret)
  // The row the connect was started from. Signed, but re-checked here against the org and the card's
  // type all the same — the start route verified it up to 30 minutes ago, and a row can be deleted or
  // retyped since. Every redirect below carries it, so a failed connect lands the user back on their
  // own channel rather than on some other row of the workspace.
  const originChannelId = await resolveOAuthReturnChannel(payload.orgId, ret, payload.channelId)
  const tenantApp = pinnedApp ? null : await getTenantMetaApp(payload.orgId)
  const appId = pinnedApp?.appId || tenantApp?.appId || process.env.FACEBOOK_APP_ID
  const appSecret = pinnedApp?.appSecret || tenantApp?.appSecret || process.env.FACEBOOK_APP_SECRET
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI
  if (!appId || !appSecret || !redirectUri) return redirectError(req, "not_configured", ret, originChannelId)

  // 1) short-lived user token
  const shortRes = await fetch(
    `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
  )
  if (!shortRes.ok) {
    console.error("[facebook-oauth] short token failed:", await redactedProviderText(shortRes))
    return redirectError(req, "token_exchange_failed", ret, originChannelId)
  }
  const shortJson = await shortRes.json() as TokenJson

  // 2) long-lived user token (~60 days)
  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortJson.access_token)}`,
  )
  if (!longRes.ok) {
    console.error("[facebook-oauth] long token failed:", await redactedProviderText(longRes))
    return redirectError(req, "long_token_failed", ret, originChannelId)
  }
  const longJson = await longRes.json() as TokenJson

  // 3) list admined pages (each comes with its own long-lived page token)
  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`,
    graphBearerInit(longJson.access_token),
  )
  if (!pagesRes.ok) {
    console.error("[facebook-oauth] /me/accounts failed:", await redactedProviderText(pagesRes))
    return redirectError(req, "pages_fetch_failed", ret, originChannelId)
  }
  const pagesJson = await pagesRes.json() as { data: Array<Page & { instagram_business_account?: { id: string; username?: string } }> }
  let pages = pagesJson.data || []

  // Facebook Login for Business: an EMPTY /me/accounts is not the same as "no pages".
  //
  // /me/accounts lists Pages by the user's own Page roles. In the business-login flow the person
  // instead picks assets in Meta's selector, and the grant is recorded against those assets — so
  // someone who reaches a Page only through a business portfolio finishes a fully-consented login
  // with an empty list. Observed 2026-09-20: Page 373662722735767 and business 1170592885027596 both
  // selected and confirmed by Meta, and this callback still answered `no_admined_pages`.
  //
  // The documented way to read what a token actually got is debug_token's `granular_scopes`, whose
  // `target_ids` name the granting entities per permission. So ask that, then fetch each Page by id.
  let grantDiagnostic = ""
  if (pages.length === 0) {
    const granted = await enumerateGrantedPages(GRAPH, appId, appSecret, longJson.access_token)
    if (granted.pages.length > 0) {
      console.log(`[facebook-oauth] /me/accounts empty; business-login grant resolved ${granted.pages.length} page(s)`)
      pages = granted.pages
    } else {
      // Say WHICH permissions the token carries. "no_admined_pages" alone sent the last debugging
      // session looking at Page roles, when the answer was in the grant.
      grantDiagnostic = granted.error
        ? `debug_token_failed`
        : granted.grantedScopes.length > 0
          ? `granted:${granted.grantedScopes.slice(0, 8).join("+")}`
          : "no_granted_scopes"
      console.error(`[facebook-oauth] no pages after business-login enumeration (${grantDiagnostic})`)
    }
  }
  if (pages.length === 0) {
    return NextResponse.redirect(
      publicUrl(req, oauthReturnUrl(ret, {
        error: grantDiagnostic ? `no_admined_pages: ${grantDiagnostic}` : "no_admined_pages",
      }, originChannelId)),
    )
  }

  let fbCount = 0
  let igCount = 0
  // Rows of the return card's type that this round trip created or updated. The loop below wires EVERY
  // Page the Meta user granted, so the card is told which of them to open instead of picking one.
  const returnCardType = oauthReturnChannelType(ret)
  const wiredForReturnCard: string[] = []

  for (const page of pages) {
    const encryptedPageToken = encryptToken(page.access_token, `oauth:facebook:${page.id}`)

    await prisma.socialAccount.upsert({
      where: {
        organizationId_platform_handle: {
          organizationId: payload.orgId,
          platform: "facebook",
          handle: page.id,
        },
      },
      update: {
        accessToken: encryptedPageToken,
        displayName: page.name,
        isActive: true,
      },
      create: {
        organizationId: payload.orgId,
        platform: "facebook",
        handle: page.id,
        displayName: page.name,
        accessToken: encryptedPageToken,
        isActive: true,
      },
    })
    fbCount++
    // Also wire this page as an INBOX channel (ChannelConfig + Meta DM-webhook subscription) so its
    // Messenger DMs reach the inbox, not just Social Monitoring. Idempotent + fail-soft.
    const pageChannel = await ensureInboxChannelForPage(payload.orgId, "facebook", page.id, page.name, page.access_token, { staged: Boolean(pinnedApp) })
    if (returnCardType === "facebook" && pageChannel.channelId) wiredForReturnCard.push(pageChannel.channelId)

    const ig = page.instagram_business_account
    if (ig) {
      // Instagram reuses the Page access token for Graph API calls.
      const encryptedIg = encryptToken(page.access_token, `oauth:instagram:${ig.id}`)
      const igHandle = (ig as { username?: string }).username || ig.id
      await prisma.socialAccount.upsert({
        where: {
          organizationId_platform_handle: {
            organizationId: payload.orgId,
            platform: "instagram",
            handle: ig.id,
          },
        },
        update: {
          accessToken: encryptedIg,
          displayName: `${page.name} / @${igHandle}`,
          isActive: true,
        },
        create: {
          organizationId: payload.orgId,
          platform: "instagram",
          handle: ig.id,
          displayName: `${page.name} / @${igHandle}`,
          accessToken: encryptedIg,
          isActive: true,
        },
      })
      igCount++
      const igChannel = await ensureInboxChannelForPage(payload.orgId, "instagram", ig.id, `${page.name} / @${igHandle}`, page.access_token, { staged: Boolean(pinnedApp) })
      if (returnCardType === "instagram" && igChannel.channelId) wiredForReturnCard.push(igChannel.channelId)
    }
  }

  await compileOrganizationSourceRoutePlans(payload.orgId)

  const res = NextResponse.redirect(
    publicUrl(req, oauthReturnUrl(
      ret,
      { connected: "facebook", pages: String(fbCount), ig: String(igCount) },
      pickOAuthReturnChannelId(originChannelId, wiredForReturnCard),
    )),
  )
  res.cookies.delete("ld_fb_oauth")
  return res
  })
}

function redirectError(req: NextRequest, code: string, ret?: string | null, channelId?: string | null): NextResponse {
  // `ret` omitted => /social-monitoring, exactly as before. URLSearchParams (inside oauthReturnUrl)
  // does the encoding, so codes like `facebook_denied: <detail>` stay safe without manual escaping.
  // `channelId` is passed only once it has been verified against the org (see originChannelId).
  return NextResponse.redirect(publicUrl(req, oauthReturnUrl(ret, { error: code }, channelId)))
}
