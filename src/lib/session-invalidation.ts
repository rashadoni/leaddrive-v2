import crypto from "crypto"

/**
 * Build an opaque, exact session epoch from the credential state stored in the
 * database. Tokens carry only this HMAC; the password hash itself never leaves
 * the server.
 *
 * Including both the password hash and passwordChangedAt covers the two ways we
 * invalidate sessions:
 *   - every password set/change produces a fresh bcrypt hash;
 *   - "log out everywhere" advances passwordChangedAt without changing the
 *     password.
 *
 * Unlike JWT `iat`, this value has no seconds-level rounding. A token issued
 * immediately before a password write can never compare equal to the state
 * read after that write.
 */
export function createSessionFingerprint(input: {
  principalId: string
  passwordHash: string | null
  passwordChangedAt?: Date | null
  secret: string
}): string {
  if (!input.secret) throw new Error("Session fingerprint secret is required")
  if (!input.principalId) throw new Error("Session fingerprint principalId is required")

  const changedAt = input.passwordChangedAt?.getTime() ?? 0
  if (!Number.isSafeInteger(changedAt) || changedAt < 0) {
    throw new Error("Invalid passwordChangedAt value")
  }

  return crypto
    .createHmac("sha256", input.secret)
    .update("leaddrive-session-fingerprint-v1\0")
    .update(input.principalId)
    .update("\0")
    .update(input.passwordHash ?? "")
    .update("\0")
    .update(String(changedAt))
    .digest("base64url")
}

/**
 * Session claims are fail-closed: legacy/malformed tokens without an exact
 * fingerprint are rejected and must authenticate again.
 */
export function hasCurrentSessionFingerprint(
  presented: unknown,
  current: string,
): boolean {
  if (typeof presented !== "string" || presented.length !== current.length) return false
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(current))
}
