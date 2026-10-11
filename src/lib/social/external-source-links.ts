const FACEBOOK_LINK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "mbasic.facebook.com",
])

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "")
}

/**
 * Builds a mobile Facebook fallback without changing the post path or
 * query string. The fallback intentionally stays opt-in: the canonical URL is
 * still the primary destination and users can try this host when `www` is
 * unreachable from their current network.
 */
export function facebookMobileUrl(value: string | null | undefined): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null
    if (!FACEBOOK_LINK_HOSTS.has(normalizedHostname(url))) return null

    url.hostname = "m.facebook.com"
    url.port = ""
    return url.toString()
  } catch {
    return null
  }
}

// The clipboard helper moved to src/lib/copy-text.ts once a second module
// needed it; it is still handed out from here for the callers that had it.
export { copyTextWithFallback } from "@/lib/copy-text"
