/**
 * Redis-backed cache layer for heavy MTM analytics queries (M4-2).
 *
 * Wraps expensive Prisma queries (KPI aggregates) behind a
 * time-limited Redis key so repeated dashboard refreshes under 351 concurrent
 * users hit memory instead of the DB.
 *
 * Design goals:
 *   - Transparent: caller provides a cacheKey, TTL, and async fetchFn.
 *   - Gracefully degraded: when Redis is unavailable (REDIS_URL unset or
 *     connection lost) the function calls fetchFn directly — no failure mode.
 *   - Write errors are non-fatal: even if Redis SET fails, the caller still
 *     gets the DB result rather than an error.
 *   - Values are JSON-serialised; no special serializer needed for plain
 *     objects / arrays (all Prisma query results qualify).
 *
 * Usage:
 *   import { withAnalyticsCache, invalidateCache } from "@/lib/cache/analytics-cache"
 *
 *   // In a route handler (60-second TTL for live supervisor view):
 *   const data = await withAnalyticsCache(
 *     `mtm:analytics:${orgId}`,
 *     60,
 *     () => prisma.mtmVisit.findMany({ where, ... }),
 *   )
 *
 *   // On write (photo uploaded, analysis completed):
 *   await invalidateCache(`mtm:analytics:${orgId}`)
 */
import { getRedisConnection } from "@/lib/queue/connection"

/**
 * Per-operation timeout for every Redis call in this module.
 *
 * WHY THIS EXISTS: the shared ioredis connection (getRedisConnection) is built
 * with `maxRetriesPerRequest: null` and the default offline queue because the
 * BullMQ workers that share it require those settings. The side effect is that
 * a command issued while Redis is DOWN is queued and waits for a reconnect
 * *indefinitely* — it never rejects. So the `try/catch` blocks below catch a
 * Redis that *throws*, but NOT a Redis that *hangs*. Without this race a cache
 * read on an unreachable Redis blocks the whole HTTP request until nginx 504s
 * it — and the browser's `res.json()` then chokes on the 504 HTML page
 * ("Unexpected token '<', \"<!DOCTYPE\"..."). That is exactly how a cache MISS
 * turned into a hard failure on the /api/v1/mtm/analytics endpoint.
 *
 * Racing every op against a short timeout restores the module's stated contract
 * — "when Redis is unavailable the function calls fetchFn directly" — for the
 * configured-but-unreachable case, not just the REDIS_URL-unset case.
 *
 * (A heavier alternative is a dedicated cache connection with
 * `enableOfflineQueue: false` + `commandTimeout`, kept separate from the BullMQ
 * one. The race is chosen here as the smaller, fully-localised fix.)
 */
export const REDIS_OP_TIMEOUT_MS = 1000

/** Race a Redis op against REDIS_OP_TIMEOUT_MS so a hung connection rejects
 *  instead of blocking the caller forever. The timer is always cleared. */
function withRedisTimeout<T>(op: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`redis ${label} timed out after ${REDIS_OP_TIMEOUT_MS}ms`)),
      REDIS_OP_TIMEOUT_MS,
    )
  })
  return Promise.race([op, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

/**
 * Try to return a cached value; on miss call fetchFn, store result, return it.
 *
 * @param cacheKey    Redis key — should encode all query parameters that affect
 *                    the result (orgId, status filter, date range, period, etc.)
 * @param ttlSeconds  Time-to-live for the cached entry in seconds.
 * @param fetchFn     Async function that performs the actual DB query.
 * @returns The cached or freshly fetched result.
 */
export async function withAnalyticsCache<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const redis = getRedisConnection()

  // ── Cache read (graceful-degrade when Redis is unavailable OR hung) ───────
  if (redis) {
    try {
      const hit = await withRedisTimeout(redis.get(cacheKey), "GET")
      if (hit !== null) {
        return JSON.parse(hit) as T
      }
    } catch {
      // Redis GET failed or timed out — fall through to fetchFn (non-fatal)
    }
  }

  // ── Fetch from DB ─────────────────────────────────────────────────────────
  const result = await fetchFn()  // let errors propagate — don't swallow DB failures

  // ── Cache write (non-fatal — write errors/timeouts must not break the response) ──
  if (redis) {
    try {
      await withRedisTimeout(redis.set(cacheKey, JSON.stringify(result), "EX", ttlSeconds), "SET")
    } catch {
      // Redis write failed or timed out — caller still gets the DB result
    }
  }

  return result
}

/**
 * Delete a cache key, e.g. after a write that invalidates the cached result.
 * No-op when Redis is unavailable.
 *
 * @param cacheKey  Key to delete.
 */
export async function invalidateCache(cacheKey: string): Promise<void> {
  const redis = getRedisConnection()
  if (!redis) return
  try {
    await withRedisTimeout(redis.del(cacheKey), "DEL")
  } catch {
    // Non-fatal (incl. timeout) — stale data will expire on its own via TTL
  }
}

/**
 * Delete all cache keys that start with `prefix`. Used to bust all cached
 * query variants for a given organization when the underlying data changes
 * (e.g. new analytics data lands — all filter combinations for that
 * org are stale simultaneously).
 *
 * Uses SCAN (cursor-based) instead of KEYS to avoid blocking the Redis event
 * loop on large keyspaces. Each SCAN call is O(1) amortized; the loop completes
 * when cursor returns to "0". COUNT 100 balances round-trips vs CPU per scan.
 *
 * No-op when Redis is unavailable or no matching keys exist.
 *
 * @param prefix  Key prefix to match, e.g. "mtm:analytics:org-1:".
 */
export async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  const redis = getRedisConnection()
  if (!redis) return
  try {
    const keysToDelete: string[] = []
    let cursor = "0"
    do {
      const [nextCursor, keys] = await withRedisTimeout(
        redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100),
        "SCAN",
      )
      cursor = nextCursor
      keysToDelete.push(...keys)
    } while (cursor !== "0")
    if (keysToDelete.length > 0) {
      await withRedisTimeout(redis.del(...keysToDelete), "DEL")
    }
  } catch {
    // Non-fatal (incl. timeout) — stale data will expire on its own via TTL
  }
}
