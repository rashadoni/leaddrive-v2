/**
 * Where a social OAuth flow should land the user when it finishes.
 *
 * The caller passes a short KEY (`?from=channels-facebook`), never a path. The key travels inside
 * the HMAC-signed OAuth `state`, and the callback resolves it back to a path from the table below.
 *
 * Why a key and not a path: the callbacks build their redirect with `new URL(path, origin)`, so any
 * externally supplied path of the form `//evil.com` or `/\evil.com` resolves to a FOREIGN origin —
 * an open redirect. Signing the state proves "we issued this value", not "this value is safe", so
 * the signature alone would not close the hole. A closed whitelist does, by construction.
 *
 * Unknown / missing keys fall back to `/social-monitoring`, the historical destination — so every
 * existing entry point (Social Monitoring tiles, onboarding checklist, Meta App Review evidence)
 * keeps behaving exactly as before.
 */
const RETURN_TARGETS = {
  "channels-facebook": "/settings/channels/connect/facebook?mode=existing&stage=connect",
  "channels-instagram": "/settings/channels/connect/instagram?mode=existing&stage=connect",
} as const

const DEFAULT_RETURN_PATH = "/social-monitoring"

export type OAuthReturnKey = keyof typeof RETURN_TARGETS

/**
 * The ChannelConfig type each channel card edits. A card is only ever handed back a row of its own
 * type: the Facebook card never opens an Instagram row, and neither opens a Telegram one.
 */
const RETURN_CHANNEL_TYPES: Record<OAuthReturnKey, "facebook" | "instagram"> = {
  "channels-facebook": "facebook",
  "channels-instagram": "instagram",
}

/**
 * Accept a raw `?from` value only when it matches a whitelisted key exactly.
 * Everything else (including own-property tricks like "constructor") returns null.
 */
export function normalizeOAuthReturnKey(raw: string | null | undefined): OAuthReturnKey | null {
  if (typeof raw !== "string") return null
  if (!Object.prototype.hasOwnProperty.call(RETURN_TARGETS, raw)) return null
  return raw as OAuthReturnKey
}

/** Channel type of the card a return key lands on; null for the Social Monitoring default. */
export function oauthReturnChannelType(key: string | null | undefined): "facebook" | "instagram" | null {
  const target = normalizeOAuthReturnKey(key)
  return target ? RETURN_CHANNEL_TYPES[target] : null
}

/**
 * Shape check for a ChannelConfig id (cuid) before it is looked up or put on a URL. It says nothing
 * about WHOSE row it is — that is proven only by a lookup scoped to the organization
 * (lib/social/oauth-return-channel.ts on the server, the session's own channel list on the page).
 */
export function normalizeOAuthReturnChannelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const id = raw.trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/**
 * Which row the channel card should open once the callback is done — or null for "none".
 *
 * `origin` is the row the connect was started from and `wired` the rows of the card's type that this
 * round trip created or updated; both are already verified to belong to the organization. The
 * callback loops over EVERY Page the Meta user granted, so on a workspace that holds several
 * customers' Pages "some row of this type" is not an answer. The rule:
 *   1. the origin, when this round trip wired it;
 *   2. otherwise the single row it wired;
 *   3. otherwise, when it wired no row of this type at all, the origin — the user lands back on the
 *      row they started from, under a banner that says Meta returned nothing for it;
 *   4. otherwise (several rows, none of them the origin) nothing: the page shows a neutral summary.
 */
export function pickOAuthReturnChannelId(origin: string | null, wired: readonly string[]): string | null {
  const unique = Array.from(new Set(wired))
  if (origin && unique.includes(origin)) return origin
  if (unique.length === 1) return unique[0]
  if (unique.length === 0) return origin
  return null
}

/**
 * Build the relative return path (`/path?query`) for a return key, merging in the result params
 * (connected/pages/ig or error). Params are encoded by URLSearchParams, so callers must NOT
 * pre-encode them.
 *
 * `channelId` names the row the landing card should open. It is attached only to a whitelisted
 * channel target — Social Monitoring has no use for it — and only in the shape a row id can have.
 * Callers pass an id they have verified against the organization; the page re-checks it against the
 * session's own channel list before it opens anything.
 */
export function oauthReturnUrl(
  key: string | null | undefined,
  params: Record<string, string>,
  channelId?: string | null,
): string {
  const target = normalizeOAuthReturnKey(key)
  const base = target ? RETURN_TARGETS[target] : DEFAULT_RETURN_PATH
  const [path, existingQuery = ""] = base.split("?")
  const search = new URLSearchParams(existingQuery)
  for (const [name, value] of Object.entries(params)) {
    search.set(name, value)
  }
  const returnChannelId = target ? normalizeOAuthReturnChannelId(channelId) : null
  if (returnChannelId) search.set("channelId", returnChannelId)
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
