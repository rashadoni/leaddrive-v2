/**
 * Short-lived, bounded, in-process memo for read-side MTM field scope.
 *
 * Why: resolving a manager's scope costs 7–11 queries (card, team, region,
 * reporting-line levels). The `/uploads/mtm-photos/*` proxy resolves it for
 * every image, so a 200-photo gallery meant ~2000 queries. A gallery, a list
 * and its filters are read by the same person within seconds.
 *
 * What it is NOT for: writes and configuration (agent administration, visit
 * policies) resolve fresh every time. A read may see a scope up to `ttlMs`
 * old after a team or reporting-line change; nothing is granted by it that a
 * fresh read did not grant a moment earlier.
 *
 * The entry stores the in-flight promise, so a burst of parallel image
 * requests shares one resolution instead of all missing at once. A rejected
 * resolution is evicted immediately and never cached.
 */
export interface TtlMemo<V> {
  get(key: string, load: () => Promise<V>): Promise<V>
  clear(): void
  readonly size: number
}

export function createTtlMemo<V>(options: {
  ttlMs: number
  maxEntries: number
  now?: () => number
}): TtlMemo<V> {
  const now = options.now ?? (() => Date.now())
  const entries = new Map<string, { expiresAt: number; value: Promise<V> }>()

  function evictExpired(at: number) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(key)
    }
  }

  return {
    get(key, load) {
      const at = now()
      const hit = entries.get(key)
      if (hit && hit.expiresAt > at) return hit.value
      if (hit) entries.delete(key)

      if (entries.size >= options.maxEntries) evictExpired(at)
      // Still full: drop the oldest insertions (Map keeps insertion order).
      while (entries.size >= options.maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }

      const value = load()
      const entry = { expiresAt: at + options.ttlMs, value }
      entries.set(key, entry)
      value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key)
      })
      return value
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

/**
 * "Once per key per TTL" gate for diagnostics (e.g. the duplicate-card
 * warning), bounded like the memo so a flood of distinct keys cannot grow it.
 */
export function createTtlThrottle(options: { ttlMs: number; maxEntries: number; now?: () => number }) {
  const now = options.now ?? (() => Date.now())
  const last = new Map<string, number>()
  return {
    /** True when `key` has not passed within the TTL; records the pass. */
    shouldRun(key: string): boolean {
      const at = now()
      const previous = last.get(key)
      if (previous !== undefined && at - previous < options.ttlMs) return false
      last.delete(key)
      while (last.size >= options.maxEntries) {
        const oldest = last.keys().next().value
        if (oldest === undefined) break
        last.delete(oldest)
      }
      last.set(key, at)
      return true
    },
    clear() {
      last.clear()
    },
  }
}
