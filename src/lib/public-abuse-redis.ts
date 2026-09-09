import IORedis, { type Redis, type RedisOptions } from "ioredis"

/**
 * Redis connection dedicated to synchronous public HTTP abuse controls.
 *
 * BullMQ's shared connection intentionally uses maxRetriesPerRequest=null and
 * keeps an offline queue. Those semantics are correct for workers but unsafe
 * on a request path: timed-out limiter commands can accumulate in memory and
 * execute after the request has already failed. This client rejects quickly,
 * never queues commands while disconnected, and reconnects in the background.
 */
const PUBLIC_GUARD_REDIS_TIMEOUT_MS = 750
const redisReadiness = new WeakMap<Redis, Promise<boolean>>()

type PublicGuardRedisGlobal = {
  __leadDrivePublicGuardRedis?: Redis
  __leadDrivePublicGuardRedisUrl?: string
}

const redisGlobal = globalThis as typeof globalThis & PublicGuardRedisGlobal

export function getPublicGuardRedisConnection(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  const cached = redisGlobal.__leadDrivePublicGuardRedis
  if (cached && redisGlobal.__leadDrivePublicGuardRedisUrl === url && cached.status !== "end") {
    return cached
  }
  if (cached) cached.disconnect()

  const options: RedisOptions = {
    connectTimeout: PUBLIC_GUARD_REDIS_TIMEOUT_MS,
    commandTimeout: PUBLIC_GUARD_REDIS_TIMEOUT_MS,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      return Math.min(times * 250, 2_000)
    },
    reconnectOnError(error) {
      return /READONLY|ECONNRESET|ETIMEDOUT/i.test(error.message)
    },
  }

  try {
    const client = new IORedis(url, options)
    client.on("error", (error) => {
      if (process.env.NODE_ENV !== "test") {
        console.error("[public-abuse-guard] Redis error:", error.message)
      }
    })
    redisGlobal.__leadDrivePublicGuardRedis = client
    redisGlobal.__leadDrivePublicGuardRedisUrl = url
    return client
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("[public-abuse-guard] Failed to create Redis connection:", error)
    }
    return null
  }
}

/**
 * A newly constructed ioredis client starts in `connecting`. Public request
 * guards must give that bounded initial connection a chance to become ready;
 * treating `connecting` as an outage makes the first request after every
 * process restart fail even when Redis is healthy.
 */
export function waitForPublicGuardRedis(redis: Redis): Promise<boolean> {
  if (redis.status === "ready") return Promise.resolve(true)
  if (redis.status === "end") return Promise.resolve(false)

  const pending = redisReadiness.get(redis)
  if (pending) return pending

  const readiness = new Promise<boolean>((resolve) => {
    let settled = false
    const timer = setTimeout(
      () => finish(redis.status === "ready"),
      PUBLIC_GUARD_REDIS_TIMEOUT_MS,
    )

    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      redis.off("ready", onReady)
      redis.off("end", onEnd)
      resolve(ready)
    }
    const onReady = () => finish(true)
    const onEnd = () => finish(false)

    redis.once("ready", onReady)
    redis.once("end", onEnd)
    // Close the event-listener race if readiness changed between the initial
    // status check and listener registration.
    queueMicrotask(() => {
      if (redis.status === "ready") finish(true)
      else if (redis.status === "end") finish(false)
    })
  }).finally(() => {
    redisReadiness.delete(redis)
  })

  redisReadiness.set(redis, readiness)
  return readiness
}

/** Test-only reset for isolated module tests. */
export function _resetPublicGuardRedisForTests(): void {
  redisGlobal.__leadDrivePublicGuardRedis?.disconnect()
  delete redisGlobal.__leadDrivePublicGuardRedis
  delete redisGlobal.__leadDrivePublicGuardRedisUrl
}
