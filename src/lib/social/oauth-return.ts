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
 * Accept a raw `?from` value only when it matches a whitelisted key exactly.
 * Everything else (including own-property tricks like "constructor") returns null.
 */
export function normalizeOAuthReturnKey(raw: string | null | undefined): OAuthReturnKey | null {
  if (typeof raw !== "string") return null
  if (!Object.prototype.hasOwnProperty.call(RETURN_TARGETS, raw)) return null
  return raw as OAuthReturnKey
}

/**
 * Build the relative return path (`/path?query`) for a return key, merging in the result params
 * (connected/pages/ig or error). Params are encoded by URLSearchParams, so callers must NOT
 * pre-encode them.
 */
export function oauthReturnUrl(key: string | null | undefined, params: Record<string, string>): string {
  const target = normalizeOAuthReturnKey(key)
  const base = target ? RETURN_TARGETS[target] : DEFAULT_RETURN_PATH
  const [path, existingQuery = ""] = base.split("?")
  const search = new URLSearchParams(existingQuery)
  for (const [name, value] of Object.entries(params)) {
    search.set(name, value)
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
