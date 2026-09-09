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

/** Clipboard API first, with the established readonly-textarea fallback for
 * constrained and embedded browsers. */
export async function copyTextWithFallback(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Continue with the DOM fallback below.
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
