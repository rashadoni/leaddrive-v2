import { prisma } from "@/lib/prisma"
import { subscribePageToMessages } from "./meta-subscribe"
import { isAppReviewOnly } from "./tenant-meta-app"

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
export type EnsureInboxChannelOptions = {
  /**
   * The OAuth that produced this token was PINNED to a staged Meta app (App Review), so this call
   * must not touch anything that already works.
   *
   * Two behaviours change, and both exist because the OAuth callback loops over EVERY page the
   * connecting Meta user administers — not just the one being tested. On a tenant like `leaddrive`,
   * which holds live customer Pages next to the review sandbox, the ordinary path would have:
   *
   *   - overwritten each live row's `apiKey` with a token minted by the app under review, and forced
   *     `isActive: true` on rows somebody had deliberately switched off; and
   *   - called `subscribed_apps` on those real Pages, moving real customers' DM delivery onto an app
   *     that is still in development.
   *
   * Staged mode therefore (a) confines the upsert to rows that are themselves staged, so a
   * pre-existing row is never read-modify-written, and (b) performs NO subscription — subscribing a
   * real asset is a deliberate act, done one page at a time through the explicit subscribe endpoint.
   * For the same reason the Facebook callback writes no SocialAccount at all on a staged connect.
   */
  staged?: boolean
}

export async function ensureInboxChannelForPage(
  organizationId: string,
  channelType: "facebook" | "instagram",
  pageId: string,
  configName: string,
  pageToken: string,
  options: EnsureInboxChannelOptions = {},
): Promise<{
  created: boolean
  subscribed: boolean
  skippedExisting?: boolean
  /**
   * The row this call created or updated. The OAuth callbacks hand it back to the channel card so the
   * card opens the channel that was actually connected — not whichever row of the workspace it would
   * otherwise pick. Absent only when the call wrote nothing (missing org, page or token).
   */
  channelId?: string
}> {
  if (!organizationId || !pageId || !pageToken) return { created: false, subscribed: false }
  const staged = options.staged === true

  // Subscribe to Meta's DM webhook. A Facebook PAGE subscribes directly via subscribed_apps.
  // Instagram Direct, however, is delivered through the LINKED Facebook Page's `messages` webhook —
  // an IG account id does NOT support subscribed_apps and returns "(#3) Application does not have the
  // capability". So for IG we SKIP the (always-failing) direct subscribe and treat it as subscribed:
  // its DMs ride the linked page's subscription (which the FB side of this same OAuth subscribes).
  // We persist the outcome on settings.inboxSubscribed so the Social Monitoring banner can prompt a
  // re-connect when a real subscribe fails (a missing pages_messaging scope).
  //
  // A STAGED connect subscribes nothing at all — see EnsureInboxChannelOptions.staged.
  const sub: { success: boolean; error?: string } =
    staged
      ? { success: false, error: "staged: subscription deferred to an explicit action" }
      : channelType === "instagram"
        ? { success: true }
        : await subscribePageToMessages(pageId, pageToken)
  if (!sub.success && !staged) {
    console.warn(`[inbox-channel] subscribe failed for ${channelType} page ${pageId}: ${sub.error}`)
  }

  // In staged mode the candidate set is restricted to staged rows. A live row for the same pageId is
  // left exactly as it is — not updated, not re-activated, not re-subscribed.
  const candidates = await prisma.channelConfig.findMany({
    where: { organizationId, channelType, pageId },
    select: { id: true, settings: true },
    orderBy: { createdAt: "asc" },
  })
  const existing = staged
    ? candidates.find((c: { id: string; settings: unknown }) => isAppReviewOnly(c.settings)) || null
    : candidates[0] || null

  if (staged && !existing && candidates.length > 0) {
    // There IS a live row for this page and we are staging. Creating a second row is still correct —
    // inbound stays with the older (live) claim by `rankInboundChannels`, so this cannot steal a
    // customer's DMs — but say so, because "connected" on a staged card must not be read as "this
    // page now delivers here".
    console.warn(
      `[inbox-channel] staged connect for ${channelType} page ${pageId}: ${candidates.length} existing row(s) left untouched`,
    )
  }

  const prevSettings =
    existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
      ? (existing.settings as Record<string, unknown>)
      : {}
  const settings: Record<string, unknown> = { ...prevSettings, inboxSubscribed: sub.success }
  if (staged) {
    settings.appReviewOnly = true
    // Distinguishes "Meta refused the subscription" from "we deliberately did not ask". Every channel
    // screen reads it (lib/channels/live-connection → `subscriptionPending`): without it a staged row
    // reads "Meta refused, reconnect", which is false.
    settings.subscriptionPending = true
  } else {
    // This call did answer the question — it asked Meta (or, for Instagram, rides the linked Page) — so
    // a marker inherited from an earlier staged connect of the same row no longer holds. Left in place, a
    // refusal right here would be shown as "not requested yet". Same rule as api/v1/social/oauth/subscribe.
    delete settings.subscriptionPending
  }

  let created = false
  let channelId: string
  if (existing) {
    await prisma.channelConfig.update({
      where: { id: existing.id },
      data: { apiKey: pageToken, isActive: true, settings },
    })
    channelId = existing.id
  } else {
    // Page rows are TOKEN carriers only (pageId + page access token). They must NOT stamp the env
    // (LeadDrive shared) appId/appSecret: in Model B that env secret would land in a tenant's scope and,
    // since the webhook resolver picks the most-recent FB/IG row, re-enable env-signed `?t=<slug>` POSTs
    // (a cross-tenant write — Codex finding). The tenant's OWN appId/appSecret + verifyToken live on
    // their Meta-app config row; the webhook + OAuth resolvers select THAT row (appSecret IS NOT NULL),
    // never a page row. (LeadDrive's own no-?t path verifies via env directly, not via any page row.)
    const row = await prisma.channelConfig.create({
      data: {
        organizationId,
        channelType,
        configName: staged ? `${configName} (App Review)` : configName,
        pageId,
        apiKey: pageToken,
        isActive: true,
        settings,
      },
      select: { id: true },
    })
    channelId = row.id
    created = true
  }

  return {
    created,
    subscribed: sub.success,
    channelId,
    ...(staged && !existing && candidates.length > 0 ? { skippedExisting: true } : {}),
  }
}
