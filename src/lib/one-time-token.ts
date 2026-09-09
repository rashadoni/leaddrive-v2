// src/lib/one-time-token.ts
import { createHash, randomBytes } from "node:crypto"

/**
 * Single-use links: the token is issued in the clear to whoever owns the
 * mailbox, and only its digest is stored.
 *
 * Used by password reset (F-28) and portal verification (F-30). Both had the
 * same defect and both are fixed the same way, so they share one module
 * rather than growing two implementations that can drift apart.
 *
 * Finding F-28 (docs/isms/ISMS-02-gap-analysis.md): `users.resetToken` held the
 * live token in plaintext and was matched by equality. A reset token is a
 * password equivalent for the hour it lives, so anyone able to read the table —
 * a leaked dump, an insider, a query through a table whose RLS is applied by
 * hand rather than by migration (F-25) — could take over any account with a
 * reset in flight. Passwords in the same row are bcrypt-hashed; the credential
 * beside them was not protected at all.
 *
 * SHA-256 rather than bcrypt is deliberate. Bcrypt defends low-entropy secrets
 * that humans choose; this token is 256 bits from a CSPRNG, so brute force is
 * already infeasible and a slow hash would only make the lookup expensive. The
 * digest is also indexable, which equality matching on a hashed column needs.
 */

/** Issues a token pair: `token` travels in the email, `tokenHash` is stored. */
export function generateOneTimeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex")
  return { token, tokenHash: hashOneTimeToken(token) }
}

/** Digest used for storage and lookup. Must stay identical on both sides. */
export function hashOneTimeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
