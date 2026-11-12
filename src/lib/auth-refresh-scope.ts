/**
 * Where the per-request session refresh from the database may be left to the route.
 *
 * The jwt callback (lib/auth.ts) re-reads the person, their company and their CRM eligibility on
 * EVERY resolution of the session cookie, so that a deactivated person, a revoked reviewer or an
 * unticked module takes effect on the very next request. An API request resolved the session
 * twice: in the proxy and again in the route's own `requireAuth` / `auth()` — ~80 ms of database
 * round-trips each on prod (2026-11-12; owner: «сайт сам долго загружает страницы»).
 *
 * For `/api/*` the proxy now uses the claims already in the cookie; the route still runs the full
 * refresh and refuses exactly as before. Pages and the auth endpoints are not touched.
 */
import { AsyncLocalStorage } from "node:async_hooks"

const scope = new AsyncLocalStorage<true>()

/** Runs `fn` with the session's database refresh deferred to the route. */
export function withSessionRefreshDeferred<T>(fn: () => T): T {
  return scope.run(true, fn)
}

/** True inside `withSessionRefreshDeferred`. */
export function sessionRefreshDeferred(): boolean {
  return scope.getStore() === true
}

/**
 * The proxy defers for API calls only. Auth endpoints sign in, rotate and update the session
 * themselves and keep the full refresh.
 */
export function proxyDefersSessionRefresh(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false
  return !/^\/api\/(?:auth|v1\/auth)(?:\/|$)/.test(pathname)
}
