/**
 * Unit tests for withAnalyticsCache (M4-2)
 *
 * Thin Redis-backed cache layer for heavy MTM analytics queries.
 * Used by MTM analytics routes to reduce
 * DB load under 351-user concurrent load (M4-1 SLO: P95 < 500 ms).
 *
 * Acceptance criteria:
 *   AC-1: Cache miss → calls fetchFn and stores JSON-serialized result in Redis
 *   AC-2: Cache hit → returns cached value without calling fetchFn
 *   AC-3: Redis unavailable (getRedisConnection returns null) → falls through to fetchFn
 *   AC-4: fetchFn error → error propagates (nothing cached)
 *   AC-5: TTL is passed to Redis SET EX command
 *   AC-6: invalidateCache deletes the key from Redis
 *   AC-7: When Redis SET throws, falls through to fetchFn result (write-error non-fatal)
 *
 * Strategy: mock getRedisConnection to return a fake Redis client, or null
 * for unavailable-Redis scenarios.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock getRedisConnection BEFORE importing the module under test ─────────
vi.mock("@/lib/queue/connection", () => ({
  getRedisConnection: vi.fn(),
}))

import { withAnalyticsCache, invalidateCache, invalidateCacheByPrefix, REDIS_OP_TIMEOUT_MS } from "@/lib/cache/analytics-cache"
import { getRedisConnection } from "@/lib/queue/connection"

// ── Fake Redis client ─────────────────────────────────────────────────────
function makeRedis(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    // Default SCAN: returns cursor "0" + empty array (no matches, loop terminates)
    scan: vi.fn().mockResolvedValue(["0", []]),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: cache miss → calls fetchFn, caches result
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-1: cache miss", () => {
  it("calls fetchFn when key is not in Redis", async () => {
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(null) })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    const fetchFn = vi.fn().mockResolvedValue({ visits: 42 })
    const result = await withAnalyticsCache("test-key", 60, fetchFn)

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(result).toEqual({ visits: 42 })
  })

  it("stores JSON-serialized result in Redis after fetch", async () => {
    const redis = makeRedis()
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    const fetchFn = vi.fn().mockResolvedValue({ visits: 7 })
    await withAnalyticsCache("field-analytics:org-1", 120, fetchFn)

    // Redis SET EX should have been called with: key, ttl, serialized value
    expect(redis.set).toHaveBeenCalledWith(
      "field-analytics:org-1",
      JSON.stringify({ visits: 7 }),
      "EX",
      120,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: cache hit → returns cached value, skips fetchFn
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-2: cache hit", () => {
  it("returns cached value when key exists in Redis", async () => {
    const cached = JSON.stringify({ visits: 99, orders: 5 })
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(cached) })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    const fetchFn = vi.fn().mockResolvedValue({ visits: 1 })
    const result = await withAnalyticsCache("test-key", 60, fetchFn)

    expect(result).toEqual({ visits: 99, orders: 5 })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("parses JSON from Redis to restore original object shape", async () => {
    const original = { dates: ["2026-05-24"], counts: [{ n: 3 }] }
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(JSON.stringify(original)) })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    const result = await withAnalyticsCache("k", 60, vi.fn())
    expect(result).toEqual(original)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: Redis unavailable → falls through to fetchFn
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-3: Redis unavailable", () => {
  it("calls fetchFn when getRedisConnection returns null", async () => {
    vi.mocked(getRedisConnection).mockReturnValue(null)

    const fetchFn = vi.fn().mockResolvedValue({ fallback: true })
    const result = await withAnalyticsCache("any-key", 60, fetchFn)

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(result).toEqual({ fallback: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: fetchFn error propagates, nothing cached
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-4: fetchFn error propagates", () => {
  it("re-throws fetchFn error without caching anything", async () => {
    const redis = makeRedis()
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    const err = new Error("DB timeout")
    const fetchFn = vi.fn().mockRejectedValue(err)

    await expect(withAnalyticsCache("key", 30, fetchFn)).rejects.toThrow("DB timeout")
    expect(redis.set).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: TTL passed correctly to Redis SET EX
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-5: TTL is respected", () => {
  it("passes the ttlSeconds value to Redis SET EX", async () => {
    const redis = makeRedis()
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    await withAnalyticsCache("key", 300, vi.fn().mockResolvedValue({}))
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", 300)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: invalidateCache deletes the key
// ─────────────────────────────────────────────────────────────────────────────

describe("invalidateCache — AC-6: deletes key from Redis", () => {
  it("calls Redis DEL with the given key", async () => {
    const redis = makeRedis()
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    await invalidateCache("field-analytics:org-1")
    expect(redis.del).toHaveBeenCalledWith("field-analytics:org-1")
  })

  it("is a no-op when Redis is unavailable", async () => {
    vi.mocked(getRedisConnection).mockReturnValue(null)
    // Should not throw even when Redis is null
    await expect(invalidateCache("any")).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: Redis SET error is non-fatal
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-7: Redis write failure is non-fatal", () => {
  it("returns fetchFn result even when Redis SET throws", async () => {
    const redis = makeRedis({
      set: vi.fn().mockRejectedValue(new Error("Redis OOM")),
    })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    const fetchFn = vi.fn().mockResolvedValue({ data: "fresh" })
    const result = await withAnalyticsCache("key", 60, fetchFn)

    // Still returns the fresh data despite cache write failure
    expect(result).toEqual({ data: "fresh" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-8 / AC-9: Redis HANG is non-fatal (the configured-but-unreachable case)
//
// Regression guard for a 504 incident: a Redis that is
// configured (REDIS_URL set) but DOWN does not throw — ioredis queues the
// command (maxRetriesPerRequest: null + offline queue) and waits for reconnect
// forever. The per-op timeout must turn that hang into a fall-through to the DB
// so the request returns instead of hanging until nginx 504s it (HTML body →
// "Unexpected token '<'" on the client).
// ─────────────────────────────────────────────────────────────────────────────

describe("withAnalyticsCache — AC-8: Redis GET hang falls through to fetchFn", () => {
  it("returns DB result when Redis GET never resolves", async () => {
    vi.useFakeTimers()
    try {
      // Simulate ioredis offline-queue hang: get() never settles.
      const redis = makeRedis({ get: vi.fn(() => new Promise(() => {})) })
      vi.mocked(getRedisConnection).mockReturnValue(redis as never)

      const fetchFn = vi.fn().mockResolvedValue({ fromDb: true })
      const resultPromise = withAnalyticsCache("hang-key", 60, fetchFn)

      // Advance past the per-op timeout → GET race rejects → fall through to DB.
      await vi.advanceTimersByTimeAsync(REDIS_OP_TIMEOUT_MS)
      const result = await resultPromise

      expect(fetchFn).toHaveBeenCalledOnce()
      expect(result).toEqual({ fromDb: true })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("withAnalyticsCache — AC-9: Redis SET hang is non-fatal", () => {
  it("returns DB result even when Redis SET never resolves", async () => {
    vi.useFakeTimers()
    try {
      // GET resolves (miss); SET hangs forever.
      const redis = makeRedis({ set: vi.fn(() => new Promise(() => {})) })
      vi.mocked(getRedisConnection).mockReturnValue(redis as never)

      const fetchFn = vi.fn().mockResolvedValue({ data: "fresh" })
      const resultPromise = withAnalyticsCache("k", 60, fetchFn)

      await vi.advanceTimersByTimeAsync(REDIS_OP_TIMEOUT_MS)
      await expect(resultPromise).resolves.toEqual({ data: "fresh" })
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// invalidateCacheByPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe("invalidateCacheByPrefix — deletes all keys matching prefix via SCAN", () => {
  it("uses SCAN cursor loop and DEL on all matched keys", async () => {
    // Two-page scan: first call returns cursor "42" + 1 key; second returns "0" + 1 key
    const scanMock = vi.fn()
      .mockResolvedValueOnce(["42", ["mtm:field-analytics:org-1:key1"]])
      .mockResolvedValueOnce(["0", ["mtm:field-analytics:org-1:key2"]])
    const redis = makeRedis({ scan: scanMock, del: vi.fn().mockResolvedValue(2) })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    await invalidateCacheByPrefix("mtm:field-analytics:org-1:")

    expect(scanMock).toHaveBeenCalledTimes(2)
    expect(scanMock).toHaveBeenCalledWith("0", "MATCH", "mtm:field-analytics:org-1:*", "COUNT", 100)
    expect(scanMock).toHaveBeenCalledWith("42", "MATCH", "mtm:field-analytics:org-1:*", "COUNT", 100)
    expect(redis.del).toHaveBeenCalledWith(
      "mtm:field-analytics:org-1:key1",
      "mtm:field-analytics:org-1:key2",
    )
  })

  it("skips DEL when SCAN returns no matching keys", async () => {
    // Single-page scan: cursor "0" + empty array — no matches
    const redis = makeRedis({
      scan: vi.fn().mockResolvedValue(["0", []]),
      del: vi.fn(),
    })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    await invalidateCacheByPrefix("mtm:field-analytics:org-empty:")

    expect(redis.del).not.toHaveBeenCalled()
  })

  it("is a no-op when Redis is unavailable", async () => {
    vi.mocked(getRedisConnection).mockReturnValue(null)
    // Must not throw
    await expect(invalidateCacheByPrefix("any:prefix:")).resolves.toBeUndefined()
  })

  it("is non-fatal when SCAN throws", async () => {
    const redis = makeRedis({
      scan: vi.fn().mockRejectedValue(new Error("Redis OOM")),
    })
    vi.mocked(getRedisConnection).mockReturnValue(redis as never)

    // Must not throw
    await expect(invalidateCacheByPrefix("mtm:field-analytics:org-1:")).resolves.toBeUndefined()
  })
})
