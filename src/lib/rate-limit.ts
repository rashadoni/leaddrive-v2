export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export const RATE_LIMIT_CONFIG = {
  api: { maxRequests: 100, windowMs: 60000 } as RateLimitConfig,
  authPrincipal: { maxRequests: 10, windowMs: 60000 } as RateLimitConfig,
  ai: { maxRequests: 20, windowMs: 60000 } as RateLimitConfig,
  public: { maxRequests: 10, windowMs: 60000 } as RateLimitConfig,
  apiKey: { maxRequests: 300, windowMs: 60000 } as RateLimitConfig,
  webhook: { maxRequests: 600, windowMs: 60000 } as RateLimitConfig,
  // Readiness polls are isolated from lifecycle callbacks so several ringing
  // channels cannot starve answered/terminal evidence from the same PBX IP.
  inboundReadiness: { maxRequests: 3600, windowMs: 60000 } as RateLimitConfig,
  // T8 Cobrowse signaling: WebRTC ICE trickle commonly fires
  // 50-100 candidates over the first 5 seconds of negotiation,
  // far above the default `public` 10/min cap. Carve a dedicated
  // bucket so legitimate handshakes don't 429 mid-flight. Keyed
  // by joinToken-hash (customer) or session id (agent) to bound
  // abuse per-session.
  cobrowseSignal: { maxRequests: 600, windowMs: 60000 } as RateLimitConfig,
}

/**
 * Hash a sensitive value (API key, token, etc.) for use as a rate-limit key.
 * SHA-256 truncated to 16 hex chars — distinct enough at scale, avoids storing
 * raw secrets in memory or leaking them via logs.
 * Uses Web Crypto (Edge-compatible).
 */
export async function hashForRateLimit(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
}

// Sliding window rate limiter — stores timestamps of recent requests per key.
// More accurate than fixed-window counters and resistant to burst-at-boundary attacks.
// In-memory only — resets on restart. For multi-instance setups, migrate to Redis.

const MAX_KEYS = 10000
const requestStore = new Map<string, number[]>()

// Periodic cleanup every 60s — remove expired entries
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, timestamps] of requestStore) {
      // Keep only timestamps within the largest window (60s)
      const filtered = timestamps.filter(t => now - t < 60000)
      if (filtered.length === 0) {
        requestStore.delete(key)
      } else {
        requestStore.set(key, filtered)
      }
    }
  }, 60000)
}

export function checkRateLimit(key: string, config: RateLimitConfig): boolean {
  const now = Date.now()
  const windowStart = now - config.windowMs

  // Evict oldest keys if store grows too large (LRU-like: delete least recently used)
  if (requestStore.size > MAX_KEYS) {
    let oldest = Infinity
    let oldestKey = ""
    for (const [k, timestamps] of requestStore) {
      const last = timestamps[timestamps.length - 1] || 0
      if (last < oldest) {
        oldest = last
        oldestKey = k
      }
    }
    if (oldestKey) requestStore.delete(oldestKey)
  }

  let timestamps = requestStore.get(key)

  if (!timestamps) {
    requestStore.set(key, [now])
    return true
  }

  // Remove timestamps outside the sliding window
  timestamps = timestamps.filter(t => t > windowStart)

  if (timestamps.length < config.maxRequests) {
    timestamps.push(now)
    requestStore.set(key, timestamps)
    return true
  }

  // Over limit — update stored timestamps (cleaned) but don't add new one
  requestStore.set(key, timestamps)
  return false
}

export function getRateLimitRemaining(
  key: string,
  config: RateLimitConfig
): number {
  const timestamps = requestStore.get(key)
  if (!timestamps) return config.maxRequests

  const windowStart = Date.now() - config.windowMs
  const active = timestamps.filter(t => t > windowStart).length
  return Math.max(0, config.maxRequests - active)
}

export function resetRateLimit(key: string): void {
  requestStore.delete(key)
}
