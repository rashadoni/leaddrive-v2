/**
 * "Is this saved ChannelConfig row an actually working connection?" — one answer, one place.
 *
 * A row existing in the table is NOT a connection for Facebook/Instagram: the channel form saves
 * with nothing but a name, and such a row delivers nothing at all. Three separate facts have to line
 * up before an inbound DM can reach Inbox, and every one of them is already written by code that
 * lives elsewhere in this project:
 *
 *   1. pageId + a stored page access token — written by the OAuth callback through
 *      `lib/social/inbox-channel.ts`. The token is what the reply path sends with; the pageId is what
 *      the webhook resolves an inbound DM against.
 *   2. `isActive` — `src/app/api/v1/webhooks/facebook/route.ts` looks the channel up with
 *      `where: { pageId, channelType: { in: ["facebook", "instagram"] }, isActive: true }`. A paused
 *      row is invisible to the resolver, so the DM is dropped before anything else is considered.
 *   3. `settings.inboxSubscribed !== false` — `ensureInboxChannelForPage` stores the outcome of the
 *      Meta `subscribed_apps` call there, and `api/v1/social/enable-inbox` already reads an explicit
 *      `false` as "Meta is not delivering DMs, the tenant must re-connect".
 *
 * The `!== false` in (3) is deliberate and matches enable-inbox: rows created before the flag existed
 * (and manually entered ones) carry no flag at all, and they must NOT be demoted to drafts on the
 * strength of a missing field. Only an explicit failure counts as a failure.
 *
 * An explicit `false` has two causes, and only one of them is a failure. A STAGED connect (App Review,
 * `?app=<id>`) deliberately asks Meta for nothing — `ensureInboxChannelForPage({ staged: true })` writes
 * `inboxSubscribed: false` beside `appReviewOnly: true` and `subscriptionPending: true`, because
 * subscribing a real Page is a separate, explicit act (`api/v1/social/oauth/subscribe`). Such a row reads
 * `subscriptionPending`, not `needsReconnect`: nobody refused anything, and re-running Connect would only
 * stage it again. It is still NOT live: LeadDrive never asked Meta to deliver, so it cannot vouch for a single
 * DM (a Page subscribed by hand from Meta's side does deliver — the review Page did on 2026-09-21 — and this
 * row has no way to see that; the explicit subscribe is how the row learns it). Both markers
 * are required, so a row that was never staged keeps exactly the old meaning, and a marker left behind
 * after someone actually asked Meta cannot relabel a refusal: the subscribe endpoint and every
 * non-staged connect delete `subscriptionPending` when they ask.
 *
 * Every other channel type keeps the historical meaning for facts (1) and (3) — a saved row is a
 * connection — because for them the row IS the credential set. Fact (2) is NOT Meta-specific and is
 * applied to every type: `webhooks/telegram`, `webhooks/whatsapp` and `webhooks/vk` all resolve the
 * channel with `isActive: true` exactly like the Facebook one, so a switched-off Telegram row drops
 * inbound messages for the same reason a switched-off Page row does. A `paused` badge on it is not a
 * new rule, it is the rule the transport already enforces.
 *
 * A fourth fact comes from OUTSIDE the row, and is Meta-specific: `claimedElsewhere`. A pageId is public and
 * several organizations can hold an active row for it; the webhooks route a contested id to the OLDEST claim
 * (lib/social/inbound-channel-ranking.ts). A row that loses that ranking to another workspace is wired, on,
 * subscribed — and receives nothing. The server computes the boolean with the webhooks' own order
 * (lib/channels/inbound-claim.ts) and ships only the boolean; this module reads it. Absent means "not
 * checked", which keeps the historical meaning, same as the `inboxSubscribed` rule above.
 *
 * KNOWN LIMITATION 1 (deliberately out of scope, tracked separately): a page access token that Meta or
 * the page owner revoked still reads as live here. Unlike WhatsApp, the FB/IG rows carry no
 * `lastValidatedAt` and there is no validation endpoint wired for them, so nothing in the product can
 * currently tell a good token from a dead one without calling Graph. Adding that probe is its own
 * feature; this module deliberately does not guess.
 *
 * KNOWN LIMITATION 2 (deliberately out of scope): for an `instagram` row, fact (3) is dead weight —
 * it is always true, so this module can never return `needsReconnect` for Instagram. Instagram Direct
 * has no subscription of its own: an IG account id does not support `subscribed_apps`, so
 * `ensureInboxChannelForPage` hardcodes `{ success: true }` for IG (lib/social/inbox-channel.ts) and
 * writes `inboxSubscribed: true` on every non-staged connect. (A staged connect writes the staged
 * markers on the IG row too, so it reads `subscriptionPending` — and keeps reading it after the linked
 * Page is subscribed, because the subscribe endpoint writes the Page row only. That errs towards
 * "unconfirmed", never towards a delivery nobody can see.) IG DMs actually ride the `messages` subscription of
 * the LINKED Facebook Page, which lives on a DIFFERENT ChannelConfig row. So the case this module
 * cannot see is: the linked Page's subscribe failed (missing `pages_messaging`) → the Page row
 * correctly reads `needsReconnect`, and the IG row beside it still reads `live` while not one DM can
 * arrive. Catching it means the predicate reading a second row (resolve the IG row's linked page,
 * then read that row's flag), i.e. an input that is no longer "this row" — a different data model for
 * the whole module, and a lookup its synchronous UI callers cannot do. Not attempted here.
 */

export const META_INBOX_CHANNEL_TYPES = ["facebook", "instagram"] as const

const META_TYPE_SET: ReadonlySet<string> = new Set<string>(META_INBOX_CHANNEL_TYPES)

/** The subset of a ChannelConfig row (API shape) that decides whether it delivers. */
export type ChannelConnectionInput = {
  channelType?: string | null
  pageId?: string | null
  isActive?: boolean | null
  /** `publicChannelConfig` never ships the raw token — it ships this boolean instead. */
  hasAccessToken?: boolean | null
  settings?: unknown
  /** Set by the channels API: another workspace's claim on this pageId wins inbound routing. */
  claimedElsewhere?: boolean | null
}

/**
 * `live`          — the row can actually receive and send.
 * `draft`         — saved, but Meta never returned a Page: no pageId and/or no page token.
 * `paused`        — wired, but `isActive` is off, so the inbound resolver cannot see it.
 * `claimedElsewhere` — wired and active, but another workspace claimed this pageId first, so the webhook
 *                     delivers its DMs there. Only support can resolve it (the tenant cannot see who).
 * `subscriptionPending` — wired and active, connected for App Review (staged), and its Meta message
 *                     subscription was deliberately never requested. Delivery is unconfirmed until the Page
 *                     is subscribed explicitly.
 * `needsReconnect`— wired and active, but the Meta webhook subscribe explicitly failed.
 */
export type ChannelConnectionState =
  | "live"
  | "draft"
  | "paused"
  | "claimedElsewhere"
  | "subscriptionPending"
  | "needsReconnect"

/**
 * `settings.inboxSubscribed` as a tri-state: `true` / `false` / `undefined` (flag absent).
 * Only a real boolean is reported; anything else is treated as "no flag written".
 */
export function metaInboxSubscribedFlag(settings: unknown): boolean | undefined {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined
  const value = (settings as Record<string, unknown>).inboxSubscribed
  return typeof value === "boolean" ? value : undefined
}

/**
 * True when a row's `inboxSubscribed: false` means "we deliberately did not ask" rather than "Meta refused":
 * a staged (App Review) row still carrying the marker its staged connect wrote. Only real `true` booleans
 * count, the same strictness as `isAppReviewOnly` in lib/social/tenant-meta-app (not imported: that module
 * reads the database, and this one runs in the browser).
 */
export function metaSubscriptionDeferred(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false
  const record = settings as Record<string, unknown>
  return record.appReviewOnly === true && record.subscriptionPending === true
}

export function channelConnectionState(channel: ChannelConnectionInput): ChannelConnectionState {
  const channelType = (channel.channelType || "").toLowerCase()
  if (!META_TYPE_SET.has(channelType)) {
    // The row is the credential set for these, so there is nothing to check but the switch — and the
    // switch is not cosmetic: every inbound webhook filters `isActive: true`. Only an EXPLICIT false
    // counts; a caller that simply did not select the column must not turn every row into a pause.
    return channel.isActive === false ? "paused" : "live"
  }
  if (!channel.pageId || !channel.hasAccessToken) return "draft"
  // Deliberately below the wiring check: a row that is both unwired and switched off is a draft, and
  // sending that user to a toggle would send them to a screen that cannot help them.
  if (channel.isActive === false) return "paused"
  // Above needsReconnect: re-running OAuth cannot help while another workspace's claim wins the routing.
  if (channel.claimedElsewhere === true) return "claimedElsewhere"
  if (metaInboxSubscribedFlag(channel.settings) === false) {
    // Keyed on the flag, not on the marker alone: `inboxSubscribed` records whether the Page IS subscribed,
    // the marker only says why it is not. A staged row a later live connect did subscribe is live.
    return metaSubscriptionDeferred(channel.settings) ? "subscriptionPending" : "needsReconnect"
  }
  return "live"
}

/** The single predicate the UI must use before it calls a channel connected. */
export function channelIsLiveConnection(channel: ChannelConnectionInput): boolean {
  return channelConnectionState(channel) === "live"
}
