/**
 * Whether a Content-Security-Policy admits a request — the host and scheme
 * half of CSP3 "Does url match source list in origin", which is the half a
 * policy test gets wrong by eye.
 *
 * Checking `expect(directive).toContain("https://*.example.com")` proves the
 * text is there, not that a request passes. On 2026-10-09 the MTM maps turned
 * out to have asked for `https://basemaps.cartocdn.com/…/style.json` for at
 * least five weeks while connect-src listed `https://*.basemaps.cartocdn.com`:
 * a host wildcard admits every subdomain and NOT the host itself.
 */

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" }

/** The sources of `name`, or of default-src when the policy has no such directive. */
export function cspDirectiveSources(policy: string, name: string): string[] {
  const directives = new Map<string, string[]>()
  for (const part of policy.split(";")) {
    const [directive, ...sources] = part.trim().split(/\s+/)
    if (directive) directives.set(directive.toLowerCase(), sources)
  }
  return directives.get(name) ?? directives.get("default-src") ?? []
}

function schemeAdmits(expressionScheme: string, urlScheme: string): boolean {
  if (expressionScheme === urlScheme) return true
  // CSP lets an insecure scheme source cover its secure upgrade, never the reverse.
  return (expressionScheme === "http:" && urlScheme === "https:") ||
    (expressionScheme === "ws:" && urlScheme === "wss:")
}

export function cspSourceAdmits(source: string, url: string, selfOrigin = "https://app.leaddrivecrm.org"): boolean {
  const target = new URL(url)
  if (source === "'self'") return target.origin === new URL(selfOrigin).origin
  // 'none', 'unsafe-inline', nonces and hashes say nothing about where a request may go.
  if (source.startsWith("'")) return false
  if (source === "*") return target.protocol in DEFAULT_PORTS
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return schemeAdmits(source.toLowerCase(), target.protocol)

  const parsed = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i)
  if (!parsed) return false
  const [, scheme, host, port, path] = parsed

  const expressionScheme = scheme ? `${scheme.toLowerCase()}:` : new URL(selfOrigin).protocol
  if (!schemeAdmits(expressionScheme, target.protocol)) return false

  const hostname = target.hostname.toLowerCase()
  const expressionHost = host.toLowerCase()
  if (expressionHost.startsWith("*.")) {
    // "*.example.com" is ".example.com" as a suffix: the bare host has no such suffix.
    if (!hostname.endsWith(expressionHost.slice(1))) return false
  } else if (expressionHost !== "*" && hostname !== expressionHost) {
    return false
  }

  const targetPort = target.port || DEFAULT_PORTS[target.protocol]
  if (port !== "*" && targetPort !== (port ?? DEFAULT_PORTS[target.protocol])) return false

  if (!path || path === "/") return true
  return path.endsWith("/") ? target.pathname.startsWith(path) : target.pathname === path
}

/** Would a request for `url`, governed by `directive`, be let through by `policy`? */
export function cspAdmits(policy: string, directive: string, url: string, selfOrigin?: string): boolean {
  return cspDirectiveSources(policy, directive).some((source) => cspSourceAdmits(source, url, selfOrigin))
}
