/**
 * How the browser learns that the session it is running on is gone.
 *
 * A page keeps rendering after its session dies — a password reset, a
 * logout-all and a deactivation each invalidate it from somewhere else — and
 * the first sign is an API call that no longer answers. The proxy marks that
 * answer with this code so the page can say "sign in again" instead of
 * surfacing a parser error.
 *
 * No imports: the proxy bundles this into the Edge runtime.
 */
export const SESSION_EXPIRED_CODE = "session_expired"

/**
 * Whether an API response means "you are no longer signed in".
 *
 * The second clause covers a response that already followed the login
 * redirect: a GET from a browser that sends no `Sec-Fetch-Mode`, or a tab
 * still running the build from before the proxy answered API calls with 401.
 */
export function isSessionExpiredResponse(response: Response): boolean {
  if (response.status === 401) return true
  if (!response.redirected) return false
  try {
    const { pathname } = new URL(response.url)
    return pathname === "/login" || pathname.startsWith("/login/")
  } catch {
    return false
  }
}
