/**
 * The bell reads the notification preferences once per sign-in, so whoever
 * saves them says so here, and every open tab of this browser reloads them.
 *
 * Before 2026-10-27 the bell refetched them on every new session object,
 * which next-auth hands out on each read — so a saved switch reached the bell
 * within 15 minutes by accident, at the price of a request per tab per read.
 */
const EVENT = "notification-preferences-changed"
const STORAGE_KEY = "ld-notification-preferences-changed-at"

export function announceNotificationPreferencesChanged(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(EVENT))
  // Other tabs hear the write as a `storage` event; this one already has the event above.
  try { localStorage.setItem(STORAGE_KEY, String(Date.now())) } catch {}
}

export function onNotificationPreferencesChanged(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange()
  }
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
}
