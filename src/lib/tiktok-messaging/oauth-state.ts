import { randomBytes, timingSafeEqual } from "node:crypto"
import { hmacToken } from "@/lib/secure-token"

const PURPOSE = "tiktok-messaging-state"
const TTL_MS = 10 * 60_000
type State = { organizationId: string; userId: string; nonce: string; issuedAt: number }

export function createMessagingState(organizationId: string, userId: string, now = Date.now()): string {
  if (!process.env.NEXTAUTH_SECRET?.trim()) throw new Error("tiktok_messaging_not_configured")
  const payload = Buffer.from(JSON.stringify({ organizationId, userId, nonce: randomBytes(32).toString("base64url"), issuedAt: now })).toString("base64url")
  return `${payload}.${hmacToken(payload, PURPOSE)}`
}

export function verifyMessagingState(value: string, now = Date.now()): State | null {
  if (!process.env.NEXTAUTH_SECRET?.trim() || value.length > 2048) return null
  try {
    const [payload, signature, extra] = value.split(".")
    if (!payload || !/^[a-f0-9]{64}$/.test(signature || "") || extra) return null
    const expected = hmacToken(payload, PURPOSE)
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const state = JSON.parse(Buffer.from(payload, "base64url").toString()) as State
    if (typeof state.organizationId !== "string" || !state.organizationId
      || typeof state.userId !== "string" || !state.userId
      || typeof state.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state.nonce)
      || !Number.isSafeInteger(state.issuedAt) || state.issuedAt > now || now - state.issuedAt > TTL_MS) return null
    return state
  } catch { return null }
}

/** The raw state never enters the database. Consumed atomically at callback. */
export function messagingStateFingerprint(state: string): string {
  return `oauth-state:${hmacToken(state, `${PURPOSE}:consume`)}`
}
