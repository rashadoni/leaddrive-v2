import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { APP_URL } from "@/lib/domains"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"
import {
  getTenantMetaApp,
  getTenantInstagramLoginApp,
  getPinnedMetaApp,
  isIgLogin,
  isAppReviewOnly,
} from "@/lib/social/tenant-meta-app"

/**
 * Meta connection preflight — what WOULD happen if you started a connect right now.
 *
 * This exists because the single most expensive mistake on this surface is invisible: an OAuth start
 * whose tenant credentials do not resolve falls back to LeadDrive's shared production app, and the
 * consent screen then shows a different App ID than the one being submitted for review. Nothing in
 * the UI said so, and the substitution was only ever caught by reading production by hand
 * (`docs/meta-app-review-session-log.md`). This endpoint makes the resolved app, and the REASON it
 * was resolved, readable before anyone records anything.
 *
 * What it deliberately does NOT return: App Secrets and webhook verify tokens, in any form — not
 * masked, not truncated, not hashed. Their presence is reported as a boolean and nothing else. App
 * IDs, redirect URIs and webhook callback URLs are public values that a tenant must be able to copy
 * into the Meta dashboard, so those are returned in full.
 *
 * Admin-only: `withSocialConnectAuth("write", …)` puts this on the `settings` RBAC scope, the same
 * boundary as starting a connect. This is integration configuration, not inbox data.
 */

/** DM webhook fields a Page/IG subscription needs; mirrors meta-subscribe.ts. */
const DM_SUBSCRIBED_FIELDS = ["messages", "messaging_postbacks"]

type SurfaceReport = {
  appId: string | null
  /**
   * Where `appId` came from. "pinned" = an explicitly named config row (isolated, no env fallback);
   * "tenant" = the org-wide Model B resolver; "env" = LeadDrive's shared production app; "none" =
   * nothing resolves and a connect would error.
   */
  source: "pinned" | "tenant" | "env" | "none"
  hasAppSecret: boolean
  hasVerifyToken: boolean
  oauthRedirectUri: string | null
  webhookCallbackUrl: string
  webhookVerifyTokenSource: "tenant-config" | "env" | "none"
}

export const GET = withSocialConnectAuth("write", async (req, auth) => {
  const orgId = auth.orgId
  const url = new URL(req.url)
  const pinnedConfigId = url.searchParams.get("app")?.trim() || null

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { slug: true, name: true },
  })
  const slug = org?.slug || null

  // Every Meta-ish config row in this tenant. Secrets are read here only to report their PRESENCE —
  // no value from these three columns is ever placed on the response.
  const rows = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: { in: ["facebook", "instagram", "whatsapp"] } },
    select: {
      id: true,
      channelType: true,
      configName: true,
      pageId: true,
      appId: true,
      appSecret: true,
      verifyToken: true,
      isActive: true,
      settings: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  })

  const [pinnedFb, pinnedIg, tenantFb, tenantIg] = await Promise.all([
    pinnedConfigId ? getPinnedMetaApp(orgId, pinnedConfigId, "facebook").catch(() => null) : null,
    pinnedConfigId ? getPinnedMetaApp(orgId, pinnedConfigId, "instagram-login").catch(() => null) : null,
    getTenantMetaApp(orgId).catch(() => null),
    getTenantInstagramLoginApp(orgId).catch(() => null),
  ])

  // The webhook callback a tenant's OWN Meta app must call. The `?t=<slug>` suffix is what makes the
  // handshake and the signature check resolve THIS tenant's verify token and app secret instead of
  // the env pair — and with `?t` present both webhook routes refuse the env fallback outright.
  const tenantWebhook = (path: string) => (slug ? `${APP_URL}${path}?t=${encodeURIComponent(slug)}` : `${APP_URL}${path}`)

  const fbWebhookRow = rows.find(
    (r) => (r.channelType === "facebook" || r.channelType === "instagram") && !isIgLogin(r.settings) && r.isActive && r.verifyToken,
  )
  const igWebhookRow = rows.find(
    (r) => r.channelType === "instagram" && isIgLogin(r.settings) && r.isActive && r.verifyToken,
  )

  const facebook: SurfaceReport = {
    appId: pinnedFb?.appId || tenantFb?.appId || process.env.FACEBOOK_APP_ID || null,
    source: pinnedFb ? "pinned" : tenantFb ? "tenant" : process.env.FACEBOOK_APP_ID ? "env" : "none",
    hasAppSecret: Boolean(pinnedFb?.appSecret || tenantFb?.appSecret || process.env.FACEBOOK_APP_SECRET),
    hasVerifyToken: Boolean(pinnedFb?.hasVerifyToken || fbWebhookRow?.verifyToken || process.env.FACEBOOK_VERIFY_TOKEN),
    oauthRedirectUri: process.env.FACEBOOK_REDIRECT_URI || null,
    webhookCallbackUrl: tenantWebhook("/api/v1/webhooks/facebook"),
    webhookVerifyTokenSource: pinnedFb?.hasVerifyToken || fbWebhookRow?.verifyToken
      ? "tenant-config"
      : process.env.FACEBOOK_VERIFY_TOKEN ? "env" : "none",
  }

  const instagramLogin: SurfaceReport = {
    appId: pinnedIg?.appId || tenantIg?.appId || process.env.INSTAGRAM_APP_ID || null,
    source: pinnedIg ? "pinned" : tenantIg ? "tenant" : process.env.INSTAGRAM_APP_ID ? "env" : "none",
    hasAppSecret: Boolean(pinnedIg?.appSecret || tenantIg?.appSecret || process.env.INSTAGRAM_APP_SECRET),
    hasVerifyToken: Boolean(pinnedIg?.hasVerifyToken || igWebhookRow?.verifyToken || process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN),
    oauthRedirectUri: process.env.INSTAGRAM_REDIRECT_URI || null,
    webhookCallbackUrl: tenantWebhook("/api/v1/webhooks/instagram"),
    webhookVerifyTokenSource: pinnedIg?.hasVerifyToken || igWebhookRow?.verifyToken
      ? "tenant-config"
      : process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ? "env" : "none",
  }

  // WhatsApp resolves per config row rather than through a Model B org resolver, so it is reported
  // straight off the row the webhook would use.
  const waRow = rows.find((r) => r.channelType === "whatsapp" && r.isActive && r.verifyToken) || null
  const whatsapp = {
    appId: waRow?.appId || null,
    source: waRow ? ("tenant" as const) : ("none" as const),
    hasAppSecret: Boolean(waRow?.appSecret),
    hasVerifyToken: Boolean(waRow?.verifyToken),
    webhookCallbackUrl: tenantWebhook("/api/v1/webhooks/whatsapp"),
    configId: waRow?.id || null,
  }

  // Rows staged for App Review. These are invisible to the org-wide resolvers ON PURPOSE (see
  // isAppReviewOnly) — listing them here is the only place they surface, together with the exact
  // start URL that activates each one.
  const stagedApps = rows
    .filter((r) => isAppReviewOnly(r.settings))
    .map((r) => {
      const igLogin = isIgLogin(r.settings)
      const surface = igLogin ? "instagram-login" : r.channelType === "whatsapp" ? "whatsapp" : "facebook"
      const startPath = igLogin
        ? `/api/v1/social/oauth/instagram/start?from=channels-instagram&app=${encodeURIComponent(r.id)}`
        : `/api/v1/social/oauth/facebook/start?from=channels-facebook&app=${encodeURIComponent(r.id)}`
      return {
        configId: r.id,
        configName: r.configName,
        channelType: r.channelType,
        surface,
        appId: r.appId,
        hasAppSecret: Boolean(r.appSecret),
        hasVerifyToken: Boolean(r.verifyToken),
        isActive: r.isActive,
        // `ready` is the whole point: all three parts present means a pinned start will resolve
        // instead of erroring. A missing part is exactly what used to fall through to the env app.
        ready: Boolean(r.appId && r.appSecret && r.verifyToken),
        startUrl: r.channelType === "whatsapp" ? null : `${APP_URL}${startPath}`,
      }
    })

  return NextResponse.json({
    organization: { slug, name: org?.name || null },
    facebook,
    instagramLogin,
    whatsapp,
    stagedApps,
    pinnedRequest: pinnedConfigId
      ? { configId: pinnedConfigId, resolvedFacebook: Boolean(pinnedFb), resolvedInstagramLogin: Boolean(pinnedIg) }
      : null,
    webhookFields: {
      facebookPage: DM_SUBSCRIBED_FIELDS,
      instagram: ["messages"],
      whatsapp: ["messages"],
    },
  })
})
