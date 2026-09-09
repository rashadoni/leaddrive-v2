/**
 * Webhook signature verifier — D5 Phase 6 Block A slice 1.
 *
 * Each payment provider signs webhook payloads with HMAC-SHA256 (the
 * common case; Stripe + PayPal + YooKassa all use it; Robokassa uses
 * MD5 — handled in its own provider module). This helper centralizes
 * the HMAC-SHA256 verification logic so providers only need to extract
 * the signed payload + signature from headers.
 *
 * **Constant-time comparison is mandatory** — naive string equality
 * leaks signature bytes via timing side-channel and lets an attacker
 * forge a webhook with statistical analysis. `crypto.timingSafeEqual`
 * compares byte-by-byte in fixed time.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

export interface HmacVerifyInput {
  /** Raw signed payload — provider-specific (some sign just the body, others sign timestamp + body). */
  signedPayload: string
  /** Expected hex-encoded signature from the request header. */
  signatureHex: string
  /** Provider's webhook signing secret. */
  secret: string
}

/**
 * Verify an HMAC-SHA256 signature in constant time.
 *
 * Returns false (NOT throws) on:
 *   - mismatched signature
 *   - malformed signatureHex (non-hex, wrong length)
 *   - empty secret
 *
 * Returning vs throwing: a webhook with a bad signature is a routine
 * occurrence (probes, mis-configured retries, race during secret
 * rotation). Slice-2 handler treats false as "respond 400 + log";
 * throwing would surface as 500 which masks the real cause.
 */
export function verifyHmacSha256(input: HmacVerifyInput): boolean {
  const { signedPayload, signatureHex, secret } = input

  if (!secret) return false
  if (!signatureHex) return false

  // Hex string must be 64 chars for SHA-256 (32 bytes × 2). Reject
  // anything else BEFORE invoking timingSafeEqual — the function
  // throws on length mismatch, which would short-circuit the
  // constant-time intent.
  if (signatureHex.length !== 64) return false
  if (!/^[a-fA-F0-9]+$/.test(signatureHex)) return false

  const expected = createHmac("sha256", secret).update(signedPayload).digest()
  let received: Buffer
  try {
    received = Buffer.from(signatureHex.toLowerCase(), "hex")
  } catch {
    return false
  }

  if (received.length !== expected.length) return false

  try {
    return timingSafeEqual(received, expected)
  } catch {
    return false
  }
}
