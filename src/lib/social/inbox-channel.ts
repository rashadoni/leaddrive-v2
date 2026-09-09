import { prisma } from "@/lib/prisma"
import { subscribePageToMessages } from "./meta-subscribe"

/**
 * Idempotently make a Facebook page / linked Instagram account an INBOX channel (FB/IG multi-tenant,
 * Slice 2). Two effects:
 *   1. UPSERT a ChannelConfig(facebook|instagram) holding the page token — this is what the inbox
 *      webhook (webhooks/facebook) resolves inbound DMs against (by pageId) and what reply-send reads
 *      (chatbot-autoreply → sendFacebookMessage(... ch.apiKey ...)). Without it, DMs are dropped.
 *   2. Subscribe the page to Meta's `messages` webhook so DMs are actually delivered (fail-soft).
 *
 * Called by the FB OAuth callback (auto, on connect) and the backfill (one-time, for pages already
 * connected for Social Monitoring only). Idempotent: find-then-update/create keyed on
 * (organizationId, channelType, pageId).
 *
 * The page token is stored raw in ChannelConfig.apiKey — matching the EXISTING ChannelConfig pattern
 * (manual entry + WhatsApp/SMS all store the send token raw; the send path reads it raw). Encrypting
 * every ChannelConfig token is a separate cross-cutting change, out of scope here.
 */
export async function ensureInboxChannelForPage(
  organizationId: string,
  channelType: "facebook" | "instagram",
  pageId: string,
  configName: string,
  pageToken: string,
): Promise<{ created: boolean; subscribed: boolean }> {
  if (!organizationId || !pageId || !pageToken) return { created: false, subscribed: false }

  // Subscribe to Meta's DM webhook. A Facebook PAGE subscribes directly via subscribed_apps.
  // Instagram Direct, however, is delivered through the LINKED Facebook Page's `messages` webhook —
  // an IG account id does NOT support subscribed_apps and returns "(#3) Application does not have the
  // capability". So for IG we SKIP the (always-failing) direct subscribe and treat it as subscribed:
  // its DMs ride the linked page's subscription (which the FB side of this same OAuth subscribes).
  // We persist the outcome on settings.inboxSubscribed so the Social Monitoring banner can prompt a
  // re-connect when a real subscribe fails (a missing pages_messaging scope).
  const sub: { success: boolean; error?: string } =
    channelType === "instagram"
      ? { success: true }
      : await subscribePageToMessages(pageId, pageToken)
  if (!sub.success) {
    console.warn(`[inbox-channel] subscribe failed for ${channelType} page ${pageId}: ${sub.error}`)
  }

  const existing = await prisma.channelConfig.findFirst({
    where: { organizationId, channelType, pageId },
    select: { id: true, settings: true },
  })
  const prevSettings =
    existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
      ? (existing.settings as Record<string, unknown>)
      : {}
  const settings = { ...prevSettings, inboxSubscribed: sub.success }

  let created = false
  if (existing) {
    await prisma.channelConfig.update({
      where: { id: existing.id },
      data: { apiKey: pageToken, isActive: true, settings },
    })
  } else {
    // Page rows are TOKEN carriers only (pageId + page access token). They must NOT stamp the env
    // (LeadDrive shared) appId/appSecret: in Model B that env secret would land in a tenant's scope and,
    // since the webhook resolver picks the most-recent FB/IG row, re-enable env-signed `?t=<slug>` POSTs
    // (a cross-tenant write — Codex finding). The tenant's OWN appId/appSecret + verifyToken live on
    // their Meta-app config row; the webhook + OAuth resolvers select THAT row (appSecret IS NOT NULL),
    // never a page row. (LeadDrive's own no-?t path verifies via env directly, not via any page row.)
    await prisma.channelConfig.create({
      data: {
        organizationId,
        channelType,
        configName,
        pageId,
        apiKey: pageToken,
        isActive: true,
        settings,
      },
    })
    created = true
  }

  return { created, subscribed: sub.success }
}
