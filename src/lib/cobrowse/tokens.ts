/**
 * T8 Cobrowse — join token generation + validation.
 *
 * Customers join a cobrowse session by presenting `joinToken` — a
 * crypto-random URL-safe value the agent shares (link, QR code, or
 * support chat reply). Tokens are:
 *   - Globally unique (DB enforces via unique index)
 *   - URL-safe base64 (no `=`, `+`, `/`)
 *   - 32 bytes of entropy (43 chars after base64url) — collision-
 *     resistant well past expected concurrent-session volume
 *   - Rotated on pause/resume (slice-2b) so a leaked token can't
 *     resume after the agent has revoked
 *
 * The token has no embedded metadata (org/session). DB lookup is the
 * canonical path: `findUnique({ joinToken })`. Keeps tokens short
 * (43 chars) at the cost of one extra index hit per join.
 */

import { randomBytes } from "node:crypto"

/** Token length in bytes BEFORE base64-url encoding. 32 bytes = 256
 *  bits of entropy → ~43-char string. Way past birthday-paradox for
 *  any realistic concurrent volume. */
export const JOIN_TOKEN_BYTES = 32

/** Exact length of a freshly-generated token. Used for cheap
 *  upfront validation before a DB round-trip. */
export const JOIN_TOKEN_LENGTH = 43

/** URL-safe alphabet — base64url RFC 4648 §5. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Generate a fresh URL-safe join token.
 *  Uses Node's native `base64url` encoding (Node 16+) — single
 *  conversion, no cargo-cult `.replace` chain. */
export function generateJoinToken(): string {
  return randomBytes(JOIN_TOKEN_BYTES).toString("base64url")
}

/** Cheap pre-lookup validation. Catches obviously-malformed input
 *  before incurring a DB query. */
export function isValidJoinTokenShape(s: string): boolean {
  return TOKEN_PATTERN.test(s)
}
