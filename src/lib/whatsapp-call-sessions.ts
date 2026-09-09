import { getRedisConnection } from "@/lib/queue/connection"

const DEFAULT_TTL_SECONDS = 180
const REDIS_TIMEOUT_MS = 500

export interface WhatsAppCallSession {
  organizationId: string
  callId: string
  sdp: string
  sdpType: "offer" | "answer"
  direction: "inbound" | "outbound"
  fromNumber: string
  toNumber: string
  conversationId: string | null
  expiresAt: string
}

type StoredSession = WhatsAppCallSession & { expiresAtMs: number }

const memorySessions = new Map<string, StoredSession>()

function memoryFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_WA_MEMORY_CALL_SESSIONS === "true"
}

export function isWhatsAppCallSessionStoreReady(): boolean {
  return !!process.env.REDIS_URL || memoryFallbackAllowed()
}

function sessionKey(organizationId: string, callId: string): string {
  return `wa-call-session:${organizationId}:${callId}`
}

function withTimeout<T>(op: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), REDIS_TIMEOUT_MS)
    op.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function pruneExpired(now = Date.now()) {
  for (const [key, value] of memorySessions.entries()) {
    if (value.expiresAtMs <= now) memorySessions.delete(key)
  }
}

function toPublicSession(value: StoredSession): WhatsAppCallSession | null {
  if (value.expiresAtMs <= Date.now()) return null
  return {
    organizationId: value.organizationId,
    callId: value.callId,
    sdp: value.sdp,
    sdpType: value.sdpType,
    direction: value.direction,
    fromNumber: value.fromNumber,
    toNumber: value.toNumber,
    conversationId: value.conversationId,
    expiresAt: value.expiresAt,
  }
}

export async function storeWhatsAppCallSession(
  input: Omit<WhatsAppCallSession, "expiresAt">,
  opts: { ttlSeconds?: number } = {},
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.floor(opts.ttlSeconds ?? DEFAULT_TTL_SECONDS))
  const expiresAtMs = Date.now() + ttlSeconds * 1000
  const session: StoredSession = {
    ...input,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  }
  const key = sessionKey(input.organizationId, input.callId)
  pruneExpired()
  memorySessions.set(key, session)

  const redis = getRedisConnection()
  if (!redis) {
    if (!memoryFallbackAllowed()) {
      memorySessions.delete(key)
      throw new Error("whatsapp_call_session_store_unavailable")
    }
    return
  }
  try {
    await withTimeout(redis.set(key, JSON.stringify(session), "EX", ttlSeconds), "wa_call_session_set")
  } catch {
    if (!memoryFallbackAllowed()) {
      memorySessions.delete(key)
      throw new Error("whatsapp_call_session_store_unavailable")
    }
    // Dev/test fallback only; production must keep short-lived SDP in Redis.
  }
}

export async function getWhatsAppCallSession(
  organizationId: string,
  callId: string,
): Promise<WhatsAppCallSession | null> {
  const key = sessionKey(organizationId, callId)
  pruneExpired()

  const redis = getRedisConnection()
  if (redis) {
    try {
      const raw = await withTimeout(redis.get(key), "wa_call_session_get")
      if (raw) {
        const parsed = JSON.parse(raw) as StoredSession
        if (parsed.expiresAtMs > Date.now()) return toPublicSession(parsed)
      }
    } catch {
      // Fall through to memory fallback.
    }
  }

  if (!memoryFallbackAllowed()) return null
  const fallback = memorySessions.get(key)
  return fallback ? toPublicSession(fallback) : null
}

export async function deleteWhatsAppCallSession(organizationId: string, callId: string): Promise<void> {
  const key = sessionKey(organizationId, callId)
  memorySessions.delete(key)
  const redis = getRedisConnection()
  if (!redis) return
  try {
    await withTimeout(redis.del(key), "wa_call_session_del")
  } catch {
    // Best-effort cleanup; TTL still expires the Redis value.
  }
}

export function _clearWhatsAppCallSessionsForTests(): void {
  memorySessions.clear()
}
