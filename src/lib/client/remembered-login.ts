/**
 * The e-mail half of "Remember me" on /login (the session half is
 * `src/lib/auth-session-lifetime.ts`).
 *
 * Ticked at a successful sign-in, the e-mail is kept on this device and the
 * next visit to /login opens with it filled in and the box ticked. Unticked,
 * it is forgotten. The password is never kept here — the browser's own
 * password manager offers that, through `autocomplete="username"` and
 * `"current-password"` on the two fields.
 *
 * Storage can be missing or throw (private window, blocked site data): then
 * the page simply starts empty, as before.
 */

const STORAGE_KEY = "leaddrive.login.rememberedEmail"

export function readRememberedEmail(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value && value.includes("@") ? value : null
  } catch {
    return null
  }
}

export function storeRememberedLogin(remember: boolean, email: string): void {
  try {
    const trimmed = email.trim()
    if (remember && trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A blocked storage must never fail a good sign-in.
  }
}
