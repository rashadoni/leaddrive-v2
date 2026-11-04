/**
 * The `state` a calendar consent carries there and back.
 *
 * It is signed because the callback must not learn whose calendar it is from
 * the request: an unsigned state would let anybody attach their own calendar
 * to another person's user. The nonce makes each consent its own, the expiry
 * keeps an abandoned one from being replayed days later, and the user and
 * organisation are checked against the database again on the way back.
 */
import crypto from "node:crypto"

const STATE_TTL_MS = 10 * 60_000

function stateSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || ""
}

export function signCalendarState(userId: string, orgId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, orgId, exp: Date.now() + STATE_TTL_MS, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url")
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  return `${payload}.${sig}`
}

export function readCalendarState(raw: string): { userId: string; orgId: string } | null {
  const [payload, signature] = raw.split(".")
  const secret = stateSecret()
  if (!payload || !signature || !secret) return null
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url")
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string; orgId?: string; exp?: number; nonce?: string }
    if (!value.userId || !value.orgId || !value.nonce || !value.exp || value.exp < Date.now()) return null
    return { userId: value.userId, orgId: value.orgId }
  } catch { return null }
}
