import { META_INBOX_CHANNEL_TYPES } from "@/lib/channels/live-connection"

/**
 * Settings keys on a Facebook/Instagram ChannelConfig that the SERVER writes and the channel form does not own.
 *
 * The channel form rebuilds `settings` from its own fields on every save (lib/channels/channel-config-payload),
 * and `PUT /api/v1/channels/[id]` used to store that object as it came — so one Save erased every key written by
 * anything else. For these rows that is not cosmetic:
 *
 *   inboxSubscribed      the outcome of Meta's `subscribed_apps` call (lib/social/inbox-channel,
 *                        api/v1/social/oauth/subscribe). lib/channels/live-connection reads a MISSING flag as
 *                        live on purpose (legacy rows), so erasing an explicit `false` turned "Reconnect needed"
 *                        into "Connected — inbound messages reach Inbox" while Meta delivered nothing.
 *   subscriptionPending  "this staged App Review connect never asked Meta" (same writers). Erased together with
 *                        `inboxSubscribed`, a staged row read as a working connection.
 *   tokenExpiresAt       expiry of the Instagram-Login token (api/v1/social/oauth/instagram/callback).
 *   username             the Instagram handle that token belongs to (same callback).
 *   replyMode … aiRolloutPercent
 *                        the reply policy, owned by api/v1/settings/channel-reply (admin-only, validated,
 *                        audited). webhooks/facebook and webhooks/instagram read `replyMode` with a default of
 *                        "agent", so an erased policy silently switched AI replies off on that Page.
 *
 * Server-owned is strict: the stored value wins whatever the request carries, so a PUT can neither erase these
 * keys nor write them. Whether Meta delivers is learned by asking Meta, and the reply policy has its own
 * endpoint. Keys the form DOES own (igLogin, appReviewOnly, loginConfigId, …) are deliberately absent, so leaving
 * one out of a save still clears it — that is how un-ticking a box in the form works.
 */
export const META_SERVER_OWNED_SETTING_KEYS = [
  "inboxSubscribed",
  "subscriptionPending",
  "tokenExpiresAt",
  "username",
  "replyMode",
  "afterHoursAi",
  "outOfOffice",
  "draftMode",
  "escalateKeywords",
  "aiThreshold",
  "aiRolloutPercent",
] as const

const META_TYPES: ReadonlySet<string> = new Set<string>(META_INBOX_CHANNEL_TYPES)

export function isMetaInboxChannelType(channelType: string | null | undefined): boolean {
  return META_TYPES.has((channelType || "").toLowerCase())
}

function asSettingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** The `settings` to store for a Meta row: the request's own keys, with every server-owned key as stored. */
export function mergeMetaSettingsForUpdate(nextSettings: unknown, existingSettings: unknown): Record<string, unknown> {
  const existing = asSettingsRecord(existingSettings)
  const merged: Record<string, unknown> = { ...asSettingsRecord(nextSettings) }
  for (const key of META_SERVER_OWNED_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) merged[key] = existing[key]
    else delete merged[key]
  }
  return merged
}
