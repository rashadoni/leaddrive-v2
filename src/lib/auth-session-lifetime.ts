/**
 * How long a CRM sign-in lasts — the "Remember me" box on /login.
 *
 * Owner 2026-11-12: «на входе добавь галочку сохранить данные чтоб каждый раз
 * не набирать». Before this, every session ended after 8 hours without a
 * request, so a person who opened the CRM in the morning typed the password
 * again the next morning.
 *
 * - Box left empty: exactly as before — the session ends after 8 hours with no
 *   activity.
 * - Box ticked: the session lasts 30 days from the last visit.
 *
 * Auth.js has one cookie lifetime for every session, so that lifetime is the
 * longer one (`REMEMBERED_SESSION_SECONDS`, `session.maxAge` in auth.ts) and
 * the shorter one is enforced here, in the jwt callback, which every session
 * read passes through (the proxy's `auth()`, `requireAuth`, /api/auth/session).
 * Nothing else changes: a password change, a deactivated user or organisation,
 * an expired reviewer grant still end the session on the next request.
 *
 * An outside reviewer is never remembered: their access is a short,
 * deliberately granted window.
 */

export const IDLE_SESSION_SECONDS = 8 * 60 * 60
export const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60

/** The login form posts the box as this field; "1" means ticked. */
export const REMEMBER_ME_FIELD = "rememberMe"

export function rememberMeRequested(credentials: unknown): boolean {
  if (!credentials || typeof credentials !== "object") return false
  const value = (credentials as Record<string, unknown>)[REMEMBER_ME_FIELD]
  return value === "1" || value === "true" || value === true
}

export interface SessionLifetimeClaims {
  rememberMe?: boolean
  lastActiveAt?: number
  iat?: number
}

/** At sign-in: write the choice and the first moment of activity. */
export function startSessionLifetime(
  token: SessionLifetimeClaims,
  options: { rememberMe: boolean; role?: string | null; nowSeconds: number },
): void {
  token.rememberMe = options.rememberMe && options.role !== "reviewer" ? true : undefined
  token.lastActiveAt = options.nowSeconds
}

/**
 * On every later read: false when a not-remembered session has been idle for
 * longer than `IDLE_SESSION_SECONDS` (the caller then drops the session);
 * otherwise records this read as activity and returns true.
 *
 * A cookie issued before this module existed has no `lastActiveAt`; its `iat`
 * is the time Auth.js last re-issued it, which is the same thing. Auth.js
 * always writes `iat`, so a token with neither is not one it decoded; it starts
 * counting now, still bounded by Auth.js' own `exp`.
 */
export function continueSessionLifetime(token: SessionLifetimeClaims, nowSeconds: number): boolean {
  if (!token.rememberMe) {
    const lastActive = typeof token.lastActiveAt === "number" ? token.lastActiveAt
      : typeof token.iat === "number" ? token.iat
      : undefined
    if (lastActive !== undefined && nowSeconds - lastActive > IDLE_SESSION_SECONDS) return false
  }
  token.lastActiveAt = nowSeconds
  return true
}
