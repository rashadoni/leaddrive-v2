/**
 * Panels that teach once and then get out of the way.
 *
 * Field UX audit 2026-09-05, task C5. The three-step orientation panel is
 * useful on the first visit and pure furniture on the two hundredth: it sits
 * above the work on five screens and pushes filters and grids below the fold
 * for people who learned the flow months ago.
 *
 * Remembering the choice per viewer, per panel, in the browser is the whole
 * mechanism. It is deliberately not a server preference: nothing depends on
 * it, and a hint that reappears on a new laptop is a smaller problem than a
 * migration and a write path for a piece of furniture.
 */
const PREFIX = "leaddrive:mtm:hint-dismissed"

export function mtmHintStorageKey(hintId: string, viewerKey?: string | null): string {
  const viewer = viewerKey ? encodeURIComponent(viewerKey) : "anonymous"
  return `${PREFIX}:${viewer}:${encodeURIComponent(hintId)}`
}

/**
 * Storage can throw, not just return null: private mode, blocked site data,
 * a locked-down corporate profile. A hint that cannot remember its state must
 * still render — never crash the page it decorates.
 */
export function isMtmHintDismissed(storage: Pick<Storage, "getItem"> | null | undefined, key: string): boolean {
  if (!storage || !key) return false
  try {
    return storage.getItem(key) === "1"
  } catch {
    return false
  }
}

/** Returns whether the choice was actually persisted; false is not an error. */
export function dismissMtmHint(storage: Pick<Storage, "setItem"> | null | undefined, key: string): boolean {
  if (!storage || !key) return false
  try {
    storage.setItem(key, "1")
    return true
  } catch {
    return false
  }
}
