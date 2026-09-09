/**
 * Signing-link token issuer + verifier — M6 Phase 6 Block C slice 1.
 *
 * Stateless HMAC-SHA-256 tokens. Format (JWS-flavoured):
 *
 *   <base64url(payload_json)>.<base64url(hmac_sha256(payload_b64, secret))>
 *
 * The plaintext token is emailed to the signer (embedded in
 * /sign/[token] URL). The token-hash (stored in `esign_signers.tokenHash`)
 * is the SAME hmac_b64 portion — verifier re-computes and uses
 * constant-time compare. This means slice-2 revocation (rotating
 * tokenHash) is independent of the HMAC secret rotation, but for
 * slice-1 the simpler model is: tokens are valid as long as
 *   (a) signature checks out, and
 *   (b) expiry is in the future.
 *
 * Pure synchronous. All inputs via parameters (no env reads in helper);
 * caller injects `secret` from `ESIGN_SECRET` env at runtime.
 *
 * Security notes:
 *   • SHA-256 HMAC — established standard, no length-extension risk
 *     vs. plain MD5/SHA1 hashes (HMAC construction is safe).
 *   • Constant-time compare via `crypto.timingSafeEqual` — defends
 *     against signature-comparison timing attacks.
 *   • Tokens carry minimal claims (envelope + signer + expiry); no
 *     PII or org data in plaintext.
 *   • Slice 2 SHOULD bump `expiresAt` semantics: short-lived view
 *     tokens (24h) + longer-lived sign-completion tokens.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto"
import {
  type IssueTokenInput,
  type IssueTokenResult,
  type TokenClaims,
  type VerifyTokenInput,
  type VerifyTokenResult,
} from "./types"

/* ─── Base64URL encode/decode (no padding) ────────────────────────────── */

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecode(s: string): Buffer {
  // Re-pad to multiple of 4.
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

/* ─── HMAC ────────────────────────────────────────────────────────────── */

function hmacB64Url(payloadB64: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(payloadB64).digest()
  return b64urlEncode(mac)
}

/* ─── Claim validation ────────────────────────────────────────────────── */

function looksLikeClaims(v: unknown): v is TokenClaims {
  if (v === null || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.eid === "string" &&
    o.eid.length > 0 &&
    typeof o.sid === "string" &&
    o.sid.length > 0 &&
    typeof o.exp === "number" &&
    Number.isFinite(o.exp) &&
    Number.isInteger(o.exp) &&
    o.exp > 0
  )
}

/* ─── Issue ───────────────────────────────────────────────────────────── */

export function issueToken(input: IssueTokenInput): IssueTokenResult {
  if (typeof input.secret !== "string" || input.secret.length === 0) {
    throw new Error("issueToken: secret must be a non-empty string")
  }
  if (!looksLikeClaims(input.claims)) {
    throw new Error("issueToken: claims must be { eid, sid, exp } with valid types")
  }
  // FIX 1 (HIGH): per-issuance nonce — each call produces a unique token + hash
  // even when claims are identical. This means re-issuing (reminders, rotation)
  // always produces a NEW tokenHash, making the old stored hash mismatch → old
  // link dies. jti is never required by verifyToken (backward-compat with tokens
  // issued before this nonce was added).
  const jti = randomBytes(16).toString("hex")
  const payloadJson = JSON.stringify({ ...input.claims, jti })
  const payloadB64 = b64urlEncode(payloadJson)
  const sigB64 = hmacB64Url(payloadB64, input.secret)
  return {
    token: `${payloadB64}.${sigB64}`,
    tokenHash: sigB64,
  }
}

/* ─── Verify ──────────────────────────────────────────────────────────── */

export function verifyToken(input: VerifyTokenInput): VerifyTokenResult {
  if (typeof input.secret !== "string" || input.secret.length === 0) {
    return { ok: false, reason: "malformed" }
  }
  if (typeof input.token !== "string" || input.token.length === 0) {
    return { ok: false, reason: "malformed" }
  }
  // Format: <payloadB64>.<sigB64>
  const dotIdx = input.token.indexOf(".")
  if (dotIdx === -1 || dotIdx === 0 || dotIdx === input.token.length - 1) {
    return { ok: false, reason: "malformed" }
  }
  const payloadB64 = input.token.slice(0, dotIdx)
  const sigB64 = input.token.slice(dotIdx + 1)
  // Token can't have multiple dots — defensive against JWT-style tokens.
  if (input.token.indexOf(".", dotIdx + 1) !== -1) {
    return { ok: false, reason: "malformed" }
  }

  // Re-compute signature.
  const expectedSigB64 = hmacB64Url(payloadB64, input.secret)
  const aBuf = Buffer.from(sigB64, "utf8")
  const bBuf = Buffer.from(expectedSigB64, "utf8")
  if (aBuf.length !== bBuf.length) {
    return { ok: false, reason: "bad_signature" }
  }
  if (!timingSafeEqual(aBuf, bBuf)) {
    return { ok: false, reason: "bad_signature" }
  }

  // Decode payload.
  let claims: unknown
  try {
    claims = JSON.parse(b64urlDecode(payloadB64).toString("utf8"))
  } catch {
    return { ok: false, reason: "invalid_payload" }
  }
  if (!looksLikeClaims(claims)) {
    return { ok: false, reason: "invalid_payload" }
  }

  // Expiry check.
  const nowUnix =
    typeof input.asOfUnix === "number" && Number.isFinite(input.asOfUnix)
      ? input.asOfUnix
      : Math.floor(Date.now() / 1000)
  if (claims.exp <= nowUnix) {
    return { ok: false, reason: "expired" }
  }

  return { ok: true, claims, tokenHash: sigB64 }
}
