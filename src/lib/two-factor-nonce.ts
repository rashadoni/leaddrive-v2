import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

export const TWO_FACTOR_NONCE_TTL_MS = 5 * 60 * 1000

type TwoFactorToken = Record<string, unknown> & {
  sub?: string
  needs2fa?: boolean
  needsSetup2fa?: boolean
  twoFactorMethod?: string
}

type TwoFactorSessionUpdate = {
  needs2fa?: unknown
  needsSetup2fa?: unknown
  twoFactorNonce?: unknown
}

/**
 * 64 lowercase hex characters so existing clients keep the same wire shape.
 * The first 12 chars encode the expiry in epoch milliseconds; the remaining
 * 52 chars provide 208 bits of randomness.
 */
export function createTwoFactorNonce(now = Date.now()): string {
  const expiryHex = (now + TWO_FACTOR_NONCE_TTL_MS).toString(16).padStart(12, "0")
  const randomBytes = new Uint8Array(26)
  globalThis.crypto.getRandomValues(randomBytes)
  const randomHex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${expiryHex}${randomHex}`
}

export function twoFactorNonceIsFresh(nonce: string, now = Date.now()): boolean {
  if (!/^[0-9a-f]{64}$/.test(nonce)) return false
  const expiresAt = Number.parseInt(nonce.slice(0, 12), 16)
  return Number.isSafeInteger(expiresAt) && expiresAt > now
}

/** Atomically consumes a fresh nonce. A successful nonce can never be reused. */
export async function consumeTwoFactorNonce(
  userId: string,
  nonce: string,
  now = Date.now(),
): Promise<boolean> {
  if (!userId || !twoFactorNonceIsFresh(nonce, now)) return false

  const result = await runWithRlsBypass(() => prisma.user.updateMany({
    where: { id: userId, twoFactorNonce: nonce },
    data: { twoFactorNonce: null },
  }))
  return result.count === 1
}

/**
 * Applies only the 2FA-sensitive part of a client session update. The caller
 * may still process harmless profile fields separately.
 */
export async function applyVerifiedTwoFactorSessionUpdate(
  token: TwoFactorToken,
  updateData: TwoFactorSessionUpdate,
  consume: (userId: string, nonce: string) => Promise<boolean> = consumeTwoFactorNonce,
): Promise<void> {
  const clearNeeds2fa = updateData.needs2fa === false && token.needs2fa === true
  const clearNeedsSetup2fa = updateData.needsSetup2fa === false && token.needsSetup2fa === true
  if (!clearNeeds2fa && !clearNeedsSetup2fa) return

  if (typeof token.sub !== "string" || typeof updateData.twoFactorNonce !== "string") return
  if (!(await consume(token.sub, updateData.twoFactorNonce))) return

  if (clearNeeds2fa) {
    token.needs2fa = undefined
    token.twoFactorMethod = undefined
  }
  if (clearNeedsSetup2fa) token.needsSetup2fa = undefined
}
