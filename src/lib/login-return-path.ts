/**
 * Where a person goes after signing in: back to the page that sent them to the
 * login, not to the home page.
 *
 * Zeytun, 2026-11-23: «göndərdiyin linklərin heç biri məndə açılmır, ümumi bura
 * atır». The proxy did name the page (`/login?callbackUrl=…`), and the login
 * page never read it: every link opened by someone signed out ended on the home
 * page, whatever it pointed at.
 *
 * The address comes from a link anyone can write, so only a page of this site
 * is accepted: never another host, never an API answer, never a sign-in page.
 * It is kept for a few minutes in the tab because a two-factor step may stand
 * between the password and the page.
 */
const KEY = "ld-after-sign-in"
const KEPT_MS = 15 * 60 * 1000
const BASE = "https://crm.invalid"
const NOT_A_DESTINATION = /^\/(?:api|login|logout|forgot-password|reset-password)(?:\/|$)/i

export function loginReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 2000 || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  // A backslash or a control character is read as «//» by browsers.
  if (/[\\\u0000-\u001f\u007f]/u.test(raw)) return "/"
  let url: URL
  try { url = new URL(raw, BASE) } catch { return "/" }
  // Judged after the parser has resolved «/./» and «/../».
  if (url.origin !== BASE || url.pathname.startsWith("//") || NOT_A_DESTINATION.test(url.pathname)) return "/"
  return `${url.pathname}${url.search}`
}

/** Called once the password is accepted, with the `callbackUrl` of the login page. */
export function rememberLoginReturn(raw: string | null | undefined, now: number = Date.now()): void {
  const path = loginReturnPath(raw)
  try {
    if (path === "/") window.sessionStorage.removeItem(KEY)
    else window.sessionStorage.setItem(KEY, JSON.stringify({ path, at: now }))
  } catch { /* no storage: the home page, as before */ }
}

export function signInDestination(now: number = Date.now()): string {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as { path?: string; at?: number } | null
    if (!kept || typeof kept.at !== "number" || now - kept.at > KEPT_MS) return "/"
    return loginReturnPath(kept.path)
  } catch {
    return "/"
  }
}
