import { randomUUID } from "node:crypto"
import { getRedisConnection } from "@/lib/queue/connection"

export const MTM_ROUTE_TRAVEL_IDEMPOTENCY_TTL_SECONDS = 5 * 60
export const MTM_ROUTE_TRAVEL_LOCK_TTL_SECONDS = 15
export const MTM_ROUTE_TRAVEL_REDIS_TIMEOUT_MS = 1_000

type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...arguments_: Array<string | number>): Promise<string | null>
  del(...keys: string[]): Promise<number>
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>
}

export type MtmRouteTravelClaimInput = {
  organizationId: string
  routeId: string
  sourceFingerprint: string
  actorKey: string
  idempotencyKey: string
  dailyLimit: number
}

export type MtmRouteTravelClaim =
  | { state: "CLAIMED"; release: () => Promise<void> }
  | { state: "PROTECTION_UNAVAILABLE" }
  | { state: "IN_FLIGHT" }
  | { state: "IDEMPOTENCY_REPLAY" }
  | { state: "IDEMPOTENCY_MISMATCH" }
  | { state: "DAILY_LIMIT_REACHED" }

const RELEASE_LOCK_SCRIPT = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('del', KEYS[1])",
  "end",
  "return 0",
].join("\n")

// The counter contains no Google content. Reserve before the request because
// a timeout can still have reached Google and therefore can still be billable.
const RESERVE_DAILY_REQUEST_SCRIPT = [
  "local count = redis.call('incr', KEYS[1])",
  "if count == 1 then",
  "  redis.call('expire', KEYS[1], ARGV[1])",
  "end",
  "if count > tonumber(ARGV[2]) then",
  "  return 0",
  "end",
  "return count",
].join("\n")

/**
 * Fail-closed, non-content lock/idempotency/budget gate for a paid provider
 * request. It deliberately stores only opaque source fingerprints and keys,
 * never ETA, distance, geometry, provider URLs, or credentials.
 */
export async function claimMtmRouteTravelPreview(
  input: MtmRouteTravelClaimInput,
  deps: { redis?: RedisLike | null; now?: Date } = {},
): Promise<MtmRouteTravelClaim> {
  const redis = deps.redis ?? getRedisConnection() as unknown as RedisLike | null
  if (!redis || !Number.isSafeInteger(input.dailyLimit) || input.dailyLimit < 1) {
    return { state: "PROTECTION_UNAVAILABLE" }
  }

  const lockKey = routeLockKey(input)
  const lockToken = randomUUID()
  let lockHeld = false
  let idempotencyClaimed = false

  const release = async () => {
    if (!lockHeld) return
    lockHeld = false
    try {
      await withRedisTimeout(
        redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken),
        "release route travel lock",
      )
    } catch {
      // The short TTL is the final protection when Redis is unavailable while
      // a request exits. Do not make the user wait for a cache cleanup.
    }
  }

  try {
    const lockResult = await withRedisTimeout(
      redis.set(lockKey, lockToken, "EX", MTM_ROUTE_TRAVEL_LOCK_TTL_SECONDS, "NX"),
      "claim route travel lock",
    )
    if (lockResult !== "OK") return { state: "IN_FLIGHT" }
    lockHeld = true

    const idempotencyKey = routeIdempotencyKey(input)
    const existingFingerprint = await withRedisTimeout(redis.get(idempotencyKey), "read route travel idempotency")
    if (existingFingerprint !== null) {
      await release()
      return existingFingerprint === input.sourceFingerprint
        ? { state: "IDEMPOTENCY_REPLAY" }
        : { state: "IDEMPOTENCY_MISMATCH" }
    }

    const idempotencyResult = await withRedisTimeout(
      redis.set(idempotencyKey, input.sourceFingerprint, "EX", MTM_ROUTE_TRAVEL_IDEMPOTENCY_TTL_SECONDS, "NX"),
      "claim route travel idempotency",
    )
    if (idempotencyResult !== "OK") {
      const concurrentFingerprint = await withRedisTimeout(redis.get(idempotencyKey), "read concurrent route travel idempotency")
      await release()
      return concurrentFingerprint === input.sourceFingerprint
        ? { state: "IDEMPOTENCY_REPLAY" }
        : { state: "IDEMPOTENCY_MISMATCH" }
    }
    idempotencyClaimed = true

    const reservation = await withRedisTimeout(
      redis.eval(
        RESERVE_DAILY_REQUEST_SCRIPT,
        1,
        routeDailyLimitKey(input, deps.now),
        String(secondsUntilNextUtcDay(deps.now)),
        String(input.dailyLimit),
      ),
      "reserve route travel daily limit",
    )
    if (Number(reservation) < 1) {
      await withRedisTimeout(redis.del(idempotencyKey), "release route travel idempotency").catch(() => undefined)
      idempotencyClaimed = false
      await release()
      return { state: "DAILY_LIMIT_REACHED" }
    }

    return { state: "CLAIMED", release }
  } catch {
    if (idempotencyClaimed) {
      await withRedisTimeout(redis.del(routeIdempotencyKey(input)), "release failed route travel idempotency").catch(() => undefined)
    }
    await release()
    return { state: "PROTECTION_UNAVAILABLE" }
  }
}

export function secondsUntilNextUtcDay(now = new Date()): number {
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1_000) + 60)
}

function routeLockKey(input: MtmRouteTravelClaimInput): string {
  return `mtm:route-travel:v1:lock:${input.organizationId}:${input.routeId}:${input.sourceFingerprint}`
}

function routeIdempotencyKey(input: MtmRouteTravelClaimInput): string {
  return `mtm:route-travel:v1:idempotency:${input.organizationId}:${input.actorKey}:${input.idempotencyKey}`
}

function routeDailyLimitKey(input: MtmRouteTravelClaimInput, now = new Date()): string {
  return `mtm:route-travel:v1:daily:${input.organizationId}:${now.toISOString().slice(0, 10)}`
}

function withRedisTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`redis ${label} timed out after ${MTM_ROUTE_TRAVEL_REDIS_TIMEOUT_MS}ms`)),
      MTM_ROUTE_TRAVEL_REDIS_TIMEOUT_MS,
    )
  })
  return Promise.race([operation, timeoutPromise]).finally(() => clearTimeout(timeout)) as Promise<T>
}
