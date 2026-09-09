// Shared helpers for {slug}.leaddrivecrm.org subdomain routing.
// Middleware uses these to bind requests to tenants; the login form uses
// them to pre-fill the `organizationSlug` field so credentials lookup is
// org-scoped (F-36). Keep this list in sync — drift means login UI
// proposes a slug that middleware rejects (or vice-versa).

export const RESERVED_SUBDOMAINS = new Set([
  "app", "admin", "api", "www", "mail", "ftp",
  "static", "cdn", "assets", "status",
])

/**
 * Parse the subdomain out of a hostname (e.g. `acme.leaddrivecrm.org` →
 * `"acme"`), returning null if:
 *   - the host doesn't end in the configured base domain
 *   - the subdomain is reserved (app/admin/api/...)
 *   - the host is a single label (localhost, an IP, etc.)
 *
 * `baseDomain` defaults to `NEXT_PUBLIC_BASE_DOMAIN` so the helper works
 * the same way in server and client code.
 */
export function getOrgSubdomain(
  host: string,
  baseDomain?: string
): string | null {
  const base = (baseDomain || process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org").replace(/^\./, "")
  const escaped = base.replace(/\./g, "\\.")
  const match = host.match(new RegExp(`^([a-z0-9][a-z0-9-]*)\\.${escaped}$`))
  if (!match) return null
  const sub = match[1]
  if (RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}

/**
 * Absolute post-sign-out URL on the host the user is currently on.
 *
 * `signOut({ callbackUrl: "/login" })` looks host-agnostic but isn't: NextAuth
 * resolves a relative callback against `baseUrl`, which is pinned by
 * `NEXTAUTH_URL` (`https://app.leaddrivecrm.org` in prod). The redirect
 * callback in `src/lib/auth.ts` then waves it through — it only checks that the
 * target is inside `*.leaddrivecrm.org` — so a tenant user signing out of
 * `zeytun.leaddrivecrm.org` lands on the app host and loses their tenant.
 *
 * Passing an absolute URL on `window.location.origin` keeps them put; the same
 * redirect callback already permits cross-subdomain targets.
 *
 * Client-only (reads `window`) — call it from event handlers, not render.
 */
export function signOutCallbackUrl(path = "/login"): string {
  if (typeof window === "undefined") return path
  return `${window.location.origin}${path}`
}

// There is deliberately NO sign-IN counterpart to the helper above.
//
// `signOut()` is a same-host operation, so an absolute current-origin callback
// is a complete fix. OAuth sign-in is not: the browser leaves for the provider
// and returns to the `redirect_uri` the server chose, and the per-flow PKCE
// verifier must still be readable when it does. Both are pinned to the app host
// (`redirect_uri` via NEXTAUTH_URL; the verifier cookie is host-only because
// only `cookies.sessionToken` carries COOKIE_DOMAIN). Starting Google/Microsoft
// sign-in from a tenant subdomain therefore dies at the PKCE check on the app
// host, before `callbackUrl` is read — passing a tenant-origin callbackUrl
// changes nothing.
//
// Verified against prod 2026-08-03; evidence, probes and the sketch of what
// real support would require: docs/oauth-tenant-subdomain.md.
