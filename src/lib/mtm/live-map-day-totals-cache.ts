/**
 * The counted day of an employee, kept for a minute.
 *
 * Two dispatchers with the same card open, or one who clicks away and back,
 * are one reading of the day's GPS fixes. Production is one process
 * (ecosystem.config.cjs), so this is shared by every request. It lives here
 * and not beside the handler because a route file exports its handlers and
 * nothing else.
 */
const TTL_MS = 60_000
const LIMIT = 500

const cache = new Map<string, { at: number; value: unknown }>()

/** Keyed by organization, employee and the organization's own day. */
export function liveMapDayTotalsCacheKey(organizationId: string, agentId: string, dayKey: string): string {
  return `${organizationId}:${agentId}:${dayKey}`
}

export function readLiveMapDayTotalsCache<T>(key: string, nowMs: number): T | null {
  const known = cache.get(key)
  return known && nowMs - known.at < TTL_MS ? known.value as T : null
}

export function writeLiveMapDayTotalsCache<T>(key: string, value: T, nowMs: number): void {
  cache.delete(key)
  if (cache.size >= LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: nowMs, value })
}

/** Test hook: forget every counted day. */
export function resetLiveMapDayTotalsCacheForTests(): void {
  cache.clear()
}
