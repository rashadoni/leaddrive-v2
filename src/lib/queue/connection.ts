/**
 * Redis connection singleton for BullMQ queues + workers.
 *
 * Part of Q4 BullMQ job queue (Phase 1 roadmap). Replaces ad-hoc cron polling
 * with a proper job queue: retries, DLQ, priority, observable state.
 *
 * Reuses the `REDIS_URL` env var already declared in `.env.example`. In dev
 * we tolerate Redis being unavailable — the queue module silently no-ops in
 * that case so a developer who hasn't started Redis can still run the app
 * (HTTP cron routes still work as a fallback during the migration).
 */
import IORedis, { type Redis, type RedisOptions } from "ioredis"

let cached: Redis | null = null
let initFailed = false

/**
 * Return a shared ioredis connection or null if Redis is unreachable.
 * BullMQ requires `maxRetriesPerRequest: null` to retry indefinitely on
 * worker reconnect; we set that explicitly.
 *
 * Caller is responsible for handling null (e.g. fall through to inline
 * execution during the migration window).
 */
export function getRedisConnection(): Redis | null {
  if (cached) return cached
  if (initFailed) return null

  const url = process.env.REDIS_URL
  if (!url) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[queue] REDIS_URL unset — queue subsystem disabled, HTTP cron routes still active")
    }
    initFailed = true
    return null
  }

  const opts: RedisOptions = {
    maxRetriesPerRequest: null, // required by BullMQ workers
    enableReadyCheck: true,
    retryStrategy(times) {
      // Slow exponential, capped at 30s. Don't hammer Redis if it's down.
      return Math.min(times * 1000, 30_000)
    },
    reconnectOnError(err) {
      // Reconnect on common transient errors.
      return /READONLY|ECONNRESET|ETIMEDOUT/i.test(err.message)
    },
  }

  try {
    const client = new IORedis(url, opts)
    client.on("error", (err) => {
      console.error("[queue] redis error:", err.message)
    })
    cached = client
    return client
  } catch (e) {
    console.error("[queue] failed to create redis connection:", e)
    initFailed = true
    return null
  }
}

/** Test-only — reset cached connection. Never call in production code. */
export function _resetForTests(): void {
  cached?.disconnect()
  cached = null
  initFailed = false
}
