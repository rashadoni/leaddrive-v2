/**
 * THE single source of truth for which link protocols a contract body may
 * carry. Previously this allowlist was duplicated three times (server
 * sanitizer hook, editor isAllowedUri, editor applyLink) — recorded as a P3
 * after the Phase-2 review precisely because a future `tel:` added to one
 * copy would silently desync the others. Client and server now share this
 * module (pure constants + a pure predicate; safe in both bundles).
 */
export const CONTRACT_LINK_PROTOCOLS = ["http:", "https:", "mailto:"] as const

/**
 * True when `url` parses as an ABSOLUTE URL with an allowlisted protocol.
 * Relative paths, protocol-relative (//host), javascript:, data:, tel:,
 * unparseable input → false. Mirrors exactly what the server hook keeps.
 */
export function isAllowedContractLinkUrl(url: string): boolean {
  try {
    return (CONTRACT_LINK_PROTOCOLS as readonly string[]).includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * The editor convenience variant: a bare domain ("example.com") gets
 * https:// prepended before validation — used by the toolbar dialog and by
 * TipTap's isAllowedUri (autolink/paste), so the canvas accepts exactly
 * what the server will keep.
 */
export function isAllowedContractLinkInput(raw: string): { ok: boolean; href: string } {
  const href = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`
  return { ok: isAllowedContractLinkUrl(href), href }
}
