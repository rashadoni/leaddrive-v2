/**
 * Which requests the service worker must never answer from a cache.
 *
 * Extracted from `src/sw.ts` so the regression suite asserts against the same
 * predicate the worker actually installs — the worker itself can't be imported
 * into the node test env (it pulls in serwist + `self`).
 *
 * Background. The worker used to bypass the cache only for
 * `request.mode === "navigate"`. That covers a full page load but NOT the RSC
 * fetches the App Router issues for client-side transitions, so `router.push()`
 * fell through to serwist's `defaultCache`, whose RSC rules are
 * StaleWhileRevalidate. A `/login` payload cached while logged OUT was then
 * replayed on top of a freshly authenticated session and the user was bounced
 * straight back to the login screen — a successful sign-in that looked like a
 * rejected password, curable only by a hard reload.
 *
 * Same-origin `/api/*` and `/uploads/*` are bypassed for a second, sharper
 * reason: the session
 * cookie is shared across `*.leaddrivecrm.org` (COOKIE_DOMAIN), so a
 * NetworkFirst `apis` cache filled under one tenant can be replayed under
 * another the moment the network blips. Offline reads do not depend on this
 * cache — MTM keeps them in its own identity-fenced IndexedDB stores
 * (`src/lib/mtm/route-cache.ts`, `operational-week-cache.ts`).
 */

/** Structural shape of the bits of `Request` this predicate reads. */
export interface SwRequestLike {
  mode?: string
  headers: { get(name: string): string | null }
}

/** Structural shape of the bits of `URL` this predicate reads. */
export interface SwUrlLike {
  origin: string
  pathname: string
  searchParams: { has(name: string): boolean }
}

/**
 * True when the response depends on who is asking (auth state / tenant) and
 * therefore must come from the network every time.
 *
 * `origin` is the worker's own origin — passed in rather than read from
 * `self` so this stays a pure function.
 */
export function isAuthStateDependentRequest(
  request: SwRequestLike,
  url: SwUrlLike,
  origin: string,
): boolean {
  // Full page loads.
  if (request.mode === "navigate") return true

  // App Router RSC traffic. Transitions send `RSC: 1`; prefetches additionally
  // carry `?_rsc=<hash>`. Match both — a prefetch cached while signed out is
  // exactly what poisoned the post-login transition.
  if (request.headers.get("RSC") === "1") return true
  if (url.searchParams.has("_rsc")) return true

  // Same-origin API traffic and protected runtime uploads. `/uploads/*` is
  // internally rewritten to an authenticated API route, but Serwist matches
  // the browser-visible URL first; allowing it into defaultCache would put
  // images in a long-lived Cache Storage entry that survives logout/tenant
  // changes and bypasses the server authorization check entirely.
  if (url.origin !== origin) return false
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")
}
