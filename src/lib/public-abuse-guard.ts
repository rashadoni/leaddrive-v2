import {
  getPublicGuardRedisConnection,
  waitForPublicGuardRedis,
} from "@/lib/public-abuse-redis"

const REDIS_TIMEOUT_MS = 750
const MAX_MEMORY_KEYS = 10_000

export interface PublicRatePolicy {
  maxRequests: number
  windowSeconds: number
}

export type PublicRateLimitIdentifierMode = "canonical" | "exact"

export interface PublicRateLimitBatchEntry {
  scope: string
  identifier: string
  policy: PublicRatePolicy
  /**
   * Existing public surfaces intentionally canonicalise human identifiers.
   * Protocol/device identifiers can opt into exact byte-for-byte hashing when
   * their own contract treats case as significant.
   */
  identifierMode?: PublicRateLimitIdentifierMode
  /**
   * A shared Redis Cluster hash tag for every key in this atomic batch. It
   * keeps the Lua script on one shard; callers should choose a stable,
   * non-sensitive partition such as a tenant identifier.
   */
  redisHashTag: string
}

export interface PublicActionPolicy {
  cooldownSeconds: number
  maxActions: number
  windowSeconds: number
}

export interface PublicConcurrencyPolicy {
  maxConcurrent: number
  leaseSeconds: number
}

export interface PublicGuardDecision {
  allowed: boolean
  retryAfterSeconds: number
  unavailable: boolean
}

type ReservationBackend = "redis" | "memory"

export type PublicActionReservation =
  | (PublicGuardDecision & { allowed: false })
  | (PublicGuardDecision & {
      allowed: true
      backend: ReservationBackend
      cooldownKey: string
      windowKey: string
      token: string
    })

export type PublicConcurrencyReservation =
  | (PublicGuardDecision & { allowed: false })
  | (PublicGuardDecision & {
      allowed: true
      backend: ReservationBackend
      key: string
      token: string
    })

const memoryRates = new Map<string, number[]>()
const memoryCooldowns = new Map<string, { token: string; expiresAt: number }>()
const memoryActions = new Map<string, Array<{ token: string; at: number }>>()
const memoryConcurrency = new Map<string, Array<{ token: string; expiresAt: number }>>()

const RATE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local member = ARGV[4]
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = tonumber(redis.call('ZCARD', key))
if count >= max_requests then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then retry = math.max(1, tonumber(oldest[2]) + window - now) end
  redis.call('PEXPIRE', key, window)
  return {0, retry}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`

// Check every bucket before adding to any of them. A sequential device →
// user → tenant sequence would charge the earlier buckets when a later one
// rejects, allowing a noisy tenant to burn healthy devices' local budgets.
const RATE_BATCH_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]

for index, key in ipairs(KEYS) do
  local window = tonumber(ARGV[3 + ((index - 1) * 2)])
  local max_requests = tonumber(ARGV[4 + ((index - 1) * 2)])
  local cutoff = now - window

  redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
  local count = tonumber(redis.call('ZCARD', key))
  if count >= max_requests then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry = window
    if oldest[2] then retry = math.max(1, tonumber(oldest[2]) + window - now) end
    redis.call('PEXPIRE', key, window)
    return {0, retry}
  end
end

for index, key in ipairs(KEYS) do
  local window = tonumber(ARGV[3 + ((index - 1) * 2)])
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
end
return {1, 0}
`

const RESERVE_ACTION_SCRIPT = `
local cooldown_key = KEYS[1]
local window_key = KEYS[2]
local now = tonumber(ARGV[1])
local cooldown = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local max_actions = tonumber(ARGV[4])
local token = ARGV[5]

local cooldown_ttl = tonumber(redis.call('PTTL', cooldown_key))
if cooldown_ttl > 0 then return {0, cooldown_ttl} end

redis.call('ZREMRANGEBYSCORE', window_key, '-inf', now - window)
local count = tonumber(redis.call('ZCARD', window_key))
if count >= max_actions then
  local oldest = redis.call('ZRANGE', window_key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then retry = math.max(1, tonumber(oldest[2]) + window - now) end
  redis.call('PEXPIRE', window_key, window)
  return {0, retry}
end

redis.call('SET', cooldown_key, token, 'PX', cooldown)
redis.call('ZADD', window_key, now, token)
redis.call('PEXPIRE', window_key, window)
return {1, 0}
`

const RELEASE_ACTION_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`

const ACQUIRE_CONCURRENCY_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expires_at = tonumber(ARGV[2])
local max_concurrent = tonumber(ARGV[3])
local token = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local count = tonumber(redis.call('ZCARD', key))
if count >= max_concurrent then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = 1000
  if oldest[2] then retry = math.max(1, tonumber(oldest[2]) - now) end
  return {0, retry}
end

redis.call('ZADD', key, expires_at, token)
redis.call('PEXPIRE', key, math.max(1, expires_at - now))
return {1, 0}
`

const RELEASE_CONCURRENCY_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
if tonumber(redis.call('ZCARD', KEYS[1])) == 0 then redis.call('DEL', KEYS[1]) end
return 1
`

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), REDIS_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

function memoryFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production"
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function safeScope(scope: string): string {
  const value = scope.toLowerCase().replace(/[^a-z0-9:_-]/g, "-").slice(0, 80)
  if (!value) throw new Error("public abuse guard scope is required")
  return value
}

async function identifierHash(
  identifier: string,
  mode: PublicRateLimitIdentifierMode = "canonical",
): Promise<string> {
  const value = mode === "exact"
    ? identifier || "unknown"
    : identifier.trim().toLowerCase() || "unknown"
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
}

async function baseKey(
  kind: string,
  scope: string,
  identifier: string,
  identifierMode: PublicRateLimitIdentifierMode = "canonical",
  redisHashTag?: string,
): Promise<string> {
  const hashTag = redisHashTag ? `{${safeScope(redisHashTag)}}:` : ""
  return `ld:public-guard:v1:${hashTag}${kind}:${safeScope(scope)}:${await identifierHash(identifier, identifierMode)}`
}

function randomToken(): string {
  return crypto.randomUUID()
}

function asRedisTuple(value: unknown): [number, number] {
  if (!Array.isArray(value)) throw new Error("invalid public abuse guard Redis response")
  const allowed = Number(value[0])
  const retryMs = Number(value[1])
  if (!Number.isFinite(allowed) || !Number.isFinite(retryMs)) {
    throw new Error("invalid public abuse guard Redis tuple")
  }
  return [allowed, retryMs]
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000))
}

function pruneMemory(now: number): void {
  for (const [key, value] of memoryCooldowns) {
    if (value.expiresAt <= now) memoryCooldowns.delete(key)
  }
  for (const [key, values] of memoryRates) {
    if (values.length === 0) memoryRates.delete(key)
  }
  for (const [key, values] of memoryActions) {
    if (values.length === 0) memoryActions.delete(key)
  }

  for (const [key, values] of memoryConcurrency) {
    const active = values.filter((slot) => slot.expiresAt > now)
    if (active.length > 0) memoryConcurrency.set(key, active)
    else memoryConcurrency.delete(key)
  }

  while (memoryRates.size + memoryCooldowns.size + memoryActions.size + memoryConcurrency.size > MAX_MEMORY_KEYS) {
    const key = memoryRates.keys().next().value as string | undefined
    if (key) memoryRates.delete(key)
    else {
      const cooldownKey = memoryCooldowns.keys().next().value as string | undefined
      if (cooldownKey) memoryCooldowns.delete(cooldownKey)
      else {
        const actionKey = memoryActions.keys().next().value as string | undefined
        if (actionKey) memoryActions.delete(actionKey)
        else {
          const concurrencyKey = memoryConcurrency.keys().next().value as string | undefined
          if (!concurrencyKey) break
          memoryConcurrency.delete(concurrencyKey)
        }
      }
    }
  }
}

export async function consumePublicRateLimit(
  scope: string,
  identifier: string,
  policy: PublicRatePolicy,
): Promise<PublicGuardDecision> {
  const maxRequests = assertPositiveInteger(policy.maxRequests, "maxRequests")
  const windowMs = assertPositiveInteger(policy.windowSeconds, "windowSeconds") * 1000
  const key = await baseKey("rate", scope, identifier)
  const now = Date.now()
  const redis = getPublicGuardRedisConnection()

  if (redis && await waitForPublicGuardRedis(redis)) {
    try {
      const tuple = asRedisTuple(await withTimeout(
        redis.eval(
          RATE_SCRIPT,
          1,
          key,
          String(now),
          String(windowMs),
          String(maxRequests),
          `${now}:${randomToken()}`,
        ),
        "public_rate_limit",
      ))
      return {
        allowed: tuple[0] === 1,
        retryAfterSeconds: tuple[0] === 1 ? 0 : retrySeconds(tuple[1]),
        unavailable: false,
      }
    } catch {
      // Production fails closed below. Dev/test retain a deterministic local fallback.
    }
  }

  if (!memoryFallbackAllowed()) return { allowed: false, retryAfterSeconds: 1, unavailable: true }

  const cutoff = now - windowMs
  const active = (memoryRates.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
  if (active.length >= maxRequests) {
    memoryRates.set(key, active)
    return { allowed: false, retryAfterSeconds: retrySeconds(active[0] + windowMs - now), unavailable: false }
  }
  active.push(now)
  memoryRates.set(key, active)
  pruneMemory(now)
  return { allowed: true, retryAfterSeconds: 0, unavailable: false }
}

type ResolvedPublicRateLimitBatchEntry = {
  key: string
  maxRequests: number
  windowMs: number
}

/**
 * Atomically consume a small set of related rate budgets. This is for request
 * paths that need device/user/tenant fairness: a denial in any bucket leaves
 * every bucket uncharged. Production uses one bounded Redis Lua command;
 * development/test use a synchronous in-process all-or-nothing fallback.
 */
export async function consumePublicRateLimitBatch(
  entries: readonly PublicRateLimitBatchEntry[],
): Promise<PublicGuardDecision> {
  if (entries.length < 1 || entries.length > 8) {
    throw new Error("public rate-limit batch must contain 1..8 entries")
  }
  const hashTags = new Set(entries.map((entry) => safeScope(entry.redisHashTag)))
  if (hashTags.size !== 1) {
    throw new Error("public rate-limit batch entries must share one Redis hash tag")
  }

  const resolved = await Promise.all(entries.map(async (entry) => ({
    key: await baseKey("rate", entry.scope, entry.identifier, entry.identifierMode, entry.redisHashTag),
    maxRequests: assertPositiveInteger(entry.policy.maxRequests, "maxRequests"),
    windowMs: assertPositiveInteger(entry.policy.windowSeconds, "windowSeconds") * 1000,
  } satisfies ResolvedPublicRateLimitBatchEntry)))
  if (new Set(resolved.map((entry) => entry.key)).size !== resolved.length) {
    throw new Error("public rate-limit batch keys must be distinct")
  }

  const now = Date.now()
  const redis = getPublicGuardRedisConnection()
  if (redis && await waitForPublicGuardRedis(redis)) {
    try {
      const args = [
        String(now),
        `${now}:${randomToken()}`,
        ...resolved.flatMap((entry) => [String(entry.windowMs), String(entry.maxRequests)]),
      ]
      const tuple = asRedisTuple(await withTimeout(
        redis.eval(RATE_BATCH_SCRIPT, resolved.length, ...resolved.map((entry) => entry.key), ...args),
        "public_rate_limit_batch",
      ))
      return {
        allowed: tuple[0] === 1,
        retryAfterSeconds: tuple[0] === 1 ? 0 : retrySeconds(tuple[1]),
        unavailable: false,
      }
    } catch {
      // Production fails closed below. Dev/test retain a deterministic local fallback.
    }
  }

  if (!memoryFallbackAllowed()) return { allowed: false, retryAfterSeconds: 1, unavailable: true }

  const active = resolved.map((entry) => ({
    ...entry,
    timestamps: (memoryRates.get(entry.key) ?? []).filter((timestamp) => timestamp > now - entry.windowMs),
  }))
  const denied = active.find((entry) => entry.timestamps.length >= entry.maxRequests)
  if (denied) {
    memoryRates.set(denied.key, denied.timestamps)
    return {
      allowed: false,
      retryAfterSeconds: retrySeconds(denied.timestamps[0]! + denied.windowMs - now),
      unavailable: false,
    }
  }

  for (const entry of active) {
    entry.timestamps.push(now)
    memoryRates.set(entry.key, entry.timestamps)
  }
  pruneMemory(now)
  return { allowed: true, retryAfterSeconds: 0, unavailable: false }
}

export async function reservePublicAction(
  scope: string,
  identifier: string,
  policy: PublicActionPolicy,
): Promise<PublicActionReservation> {
  const cooldownMs = assertPositiveInteger(policy.cooldownSeconds, "cooldownSeconds") * 1000
  const maxActions = assertPositiveInteger(policy.maxActions, "maxActions")
  const windowMs = assertPositiveInteger(policy.windowSeconds, "windowSeconds") * 1000
  const rootKey = await baseKey("action", scope, identifier)
  const cooldownKey = `${rootKey}:cooldown`
  const windowKey = `${rootKey}:window`
  const token = randomToken()
  const now = Date.now()
  const redis = getPublicGuardRedisConnection()

  if (redis && await waitForPublicGuardRedis(redis)) {
    try {
      const tuple = asRedisTuple(await withTimeout(
        redis.eval(
          RESERVE_ACTION_SCRIPT,
          2,
          cooldownKey,
          windowKey,
          String(now),
          String(cooldownMs),
          String(windowMs),
          String(maxActions),
          token,
        ),
        "public_action_reserve",
      ))
      if (tuple[0] !== 1) {
        return { allowed: false, retryAfterSeconds: retrySeconds(tuple[1]), unavailable: false }
      }
      return {
        allowed: true,
        retryAfterSeconds: 0,
        unavailable: false,
        backend: "redis",
        cooldownKey,
        windowKey,
        token,
      }
    } catch {
      // Production fails closed below. Dev/test retain a deterministic local fallback.
    }
  }

  if (!memoryFallbackAllowed()) return { allowed: false, retryAfterSeconds: 1, unavailable: true }

  pruneMemory(now)
  const cooldown = memoryCooldowns.get(cooldownKey)
  if (cooldown && cooldown.expiresAt > now) {
    return { allowed: false, retryAfterSeconds: retrySeconds(cooldown.expiresAt - now), unavailable: false }
  }

  const cutoff = now - windowMs
  const active = (memoryActions.get(windowKey) ?? []).filter((action) => action.at > cutoff)
  if (active.length >= maxActions) {
    memoryActions.set(windowKey, active)
    return { allowed: false, retryAfterSeconds: retrySeconds(active[0].at + windowMs - now), unavailable: false }
  }

  memoryCooldowns.set(cooldownKey, { token, expiresAt: now + cooldownMs })
  active.push({ token, at: now })
  memoryActions.set(windowKey, active)
  return {
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
    backend: "memory",
    cooldownKey,
    windowKey,
    token,
  }
}

export async function releasePublicActionReservation(reservation: PublicActionReservation): Promise<void> {
  if (!reservation.allowed) return

  if (reservation.backend === "redis") {
    const redis = getPublicGuardRedisConnection()
    if (!redis || !(await waitForPublicGuardRedis(redis))) return
    try {
      await withTimeout(
        redis.eval(
          RELEASE_ACTION_SCRIPT,
          2,
          reservation.cooldownKey,
          reservation.windowKey,
          reservation.token,
        ),
        "public_action_release",
      )
    } catch {
      // Best effort: both Redis keys have bounded TTLs.
    }
    return
  }

  const cooldown = memoryCooldowns.get(reservation.cooldownKey)
  if (cooldown?.token === reservation.token) memoryCooldowns.delete(reservation.cooldownKey)
  const actions = memoryActions.get(reservation.windowKey) ?? []
  const remaining = actions.filter((action) => action.token !== reservation.token)
  if (remaining.length > 0) memoryActions.set(reservation.windowKey, remaining)
  else memoryActions.delete(reservation.windowKey)
}

export async function acquirePublicConcurrencySlot(
  scope: string,
  identifier: string,
  policy: PublicConcurrencyPolicy,
): Promise<PublicConcurrencyReservation> {
  const maxConcurrent = assertPositiveInteger(policy.maxConcurrent, "maxConcurrent")
  const leaseMs = assertPositiveInteger(policy.leaseSeconds, "leaseSeconds") * 1000
  const key = await baseKey("concurrency", scope, identifier)
  const token = randomToken()
  const now = Date.now()
  const expiresAt = now + leaseMs
  const redis = getPublicGuardRedisConnection()

  if (redis && await waitForPublicGuardRedis(redis)) {
    try {
      const tuple = asRedisTuple(await withTimeout(
        redis.eval(
          ACQUIRE_CONCURRENCY_SCRIPT,
          1,
          key,
          String(now),
          String(expiresAt),
          String(maxConcurrent),
          token,
        ),
        "public_concurrency_acquire",
      ))
      if (tuple[0] !== 1) {
        return { allowed: false, retryAfterSeconds: retrySeconds(tuple[1]), unavailable: false }
      }
      return {
        allowed: true,
        retryAfterSeconds: 0,
        unavailable: false,
        backend: "redis",
        key,
        token,
      }
    } catch {
      // Production fails closed below. Dev/test retain a deterministic local fallback.
    }
  }

  if (!memoryFallbackAllowed()) return { allowed: false, retryAfterSeconds: 1, unavailable: true }

  pruneMemory(now)
  const active = (memoryConcurrency.get(key) ?? []).filter((slot) => slot.expiresAt > now)
  if (active.length >= maxConcurrent) {
    memoryConcurrency.set(key, active)
    const oldest = Math.min(...active.map((slot) => slot.expiresAt))
    return { allowed: false, retryAfterSeconds: retrySeconds(oldest - now), unavailable: false }
  }
  active.push({ token, expiresAt })
  memoryConcurrency.set(key, active)
  return {
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
    backend: "memory",
    key,
    token,
  }
}

export async function releasePublicConcurrencySlot(
  reservation: PublicConcurrencyReservation,
): Promise<void> {
  if (!reservation.allowed) return

  if (reservation.backend === "redis") {
    const redis = getPublicGuardRedisConnection()
    if (!redis || !(await waitForPublicGuardRedis(redis))) return
    try {
      await withTimeout(
        redis.eval(RELEASE_CONCURRENCY_SCRIPT, 1, reservation.key, reservation.token),
        "public_concurrency_release",
      )
    } catch {
      // Best effort: the slot has a short lease and expires automatically.
    }
    return
  }

  const active = memoryConcurrency.get(reservation.key) ?? []
  const remaining = active.filter((slot) => slot.token !== reservation.token)
  if (remaining.length > 0) memoryConcurrency.set(reservation.key, remaining)
  else memoryConcurrency.delete(reservation.key)
}

/** Test-only reset for deterministic isolated unit tests. */
export function _resetPublicAbuseGuardForTests(): void {
  memoryRates.clear()
  memoryCooldowns.clear()
  memoryActions.clear()
  memoryConcurrency.clear()
}
