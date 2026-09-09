/**
 * Who is looking at the screen, for things remembered per person in a browser.
 *
 * Field UX audit 2026-09-05, C5 tail. The dismissible guide sits on five
 * screens; only «Визиты» could actually dismiss it, because the other four
 * render the panel without telling it whose choice to remember. Wiring those
 * four means deriving the viewer in four more places, and the derivation was
 * already copied three times — so it moves here first.
 *
 * The fallback is deliberately an empty string, not a name like "no-viewer":
 * {@link mtmHintStorageKey} already decides what "nobody" is called, and
 * spelling it here too would put that decision back in every call site — the
 * exact split C8 removed from planner draft keys.
 *
 * (The dashboard has its own `viewerKey` with a "no-viewer" fallback. It is
 * left alone on purpose: it scopes request caches, never storage keys, so the
 * two never meet.)
 *
 * It is a storage discriminator, never an authorisation check: the server
 * decides what a person may see, and this only decides whose preference is
 * whose. That is why an unauthenticated viewer collapses into one shared
 * bucket instead of being an error.
 */

export type MtmViewer = {
  user?: { id?: string | null; email?: string | null } | null
} | null | undefined

/**
 * The stable part of a session, or an empty string when there is none —
 * callers pass it straight to a storage-key builder, which decides what
 * "nobody" is called. Returning the name here would spread that decision back
 * across the call sites this exists to unify.
 */
export function mtmViewerKey(session: MtmViewer): string {
  const id = session?.user?.id
  if (typeof id === "string" && id.trim()) return id.trim()
  const email = session?.user?.email
  if (typeof email === "string" && email.trim()) return email.trim()
  return ""
}
