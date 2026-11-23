/**
 * Who is signed in travels with the page, instead of being asked for after it.
 *
 * Measured on production 2026-11-23, owner's browser (the complaint: «очень
 * долго открывается срм»). Every page of the CRM opened as a staircase: the
 * document (0.3–0.9 s) → the browser asks `/api/auth/session` (0.55–1.8 s) →
 * only then does the page mount and start loading its own data (1.4–3.6 s). The
 * shell holds every page back until the session is known
 * (`(dashboard)/layout.tsx`, `childrenReady`), and next-auth's provider learns
 * it with a request of its own after the JavaScript has started — twice, the
 * second one provoked by the first one's own cross-tab broadcast, and once more
 * in every other open CRM tab.
 *
 * The server that renders the document already knows the answer: the proxy has
 * just resolved the very same session to let the request through. So the root
 * layout reads it here and hands it to the provider, and the page starts its
 * data the moment it becomes interactive.
 *
 * What is read is exactly what `/api/auth/session` would answer for the same
 * cookie — `auth()` runs the same jwt and session callbacks, with the full
 * fail-closed refresh from the database (a module unticked a minute ago is
 * already unticked here). Nothing about signing in, signing out, the 15-minute
 * refresh or a session ended on the server changes.
 */
import type { Session } from "next-auth"

/**
 * Sign-in pages keep learning the session the way they always have. Their flows
 * are the delicate ones (a password just accepted, a second factor still owed),
 * and a person is on them for seconds.
 */
const SIGN_IN_PATHS = new Set([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/login/setup-2fa",
  "/login/verify-2fa",
])

/** The customer portal signs in with its own cookie; a CRM session means nothing there. */
const PORTAL_PATH = "/portal"

export function documentCarriesSession(pathname: string | null): boolean {
  const path = pathname?.replace(/\/+$/, "") || "/"
  if (SIGN_IN_PATHS.has(path)) return false
  if (path === PORTAL_PATH || path.startsWith(`${PORTAL_PATH}/`)) return false
  return true
}

/**
 * A session the page may start with, or `null` — and `null` means only «ask the
 * way you used to», never «nobody is signed in»: the provider then makes its
 * own request, exactly as before this module existed.
 *
 * A session that still owes its second factor is not handed over either: the
 * proxy keeps such a person on the sign-in pages, and anything else that might
 * render for them must not read as signed in.
 */
export function sessionWorthCarrying(session: Session | null | undefined): Session | null {
  const user = session?.user as { id?: string; organizationId?: string; needs2fa?: boolean; needsSetup2fa?: boolean } | undefined
  if (!session || !user?.id || !user.organizationId) return null
  if (user.needs2fa || user.needsSetup2fa) return null
  return session
}

export async function readSessionForDocument(pathname: string | null): Promise<Session | null> {
  if (!documentCarriesSession(pathname)) return null
  try {
    // Loaded here rather than at the top: the root layout is every document's
    // layout, the sign-in and portal pages included, and those never get this far.
    const { auth } = await import("@/lib/auth")
    return sessionWorthCarrying(await auth())
  } catch {
    // The database blinked, or there is no request to read a cookie from. The
    // browser asks for itself, as it did before.
    return null
  }
}
