/**
 * AES-256-GCM encryption for sensitive tokens stored in DB
 * (OAuth access/refresh tokens, webhook secrets, etc.).
 *
 * Key derivation:
 *   Uses HKDF on NEXTAUTH_SECRET with a purpose-specific "info" string.
 *   If NEXTAUTH_SECRET is short, we hash-stretch it to 32 bytes first.
 *
 * Format on the wire (base64url):
 *   "v1:" + base64url(iv || ciphertext || authTag)
 *
 * Legacy plaintext values (no "v1:" prefix) are returned as-is by `decrypt` for
 * backward compat while rotating existing data. New writes always use "v1:".
 */

import crypto from "crypto"

const VERSION = "v1"

function getMasterSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (secret) return secret
  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXTAUTH_SECRET is required for token encryption in production")
  }
  return "ld-dev-fallback-secret-change-me"
}

function deriveKey(purpose: string): Buffer {
  const secret = getMasterSecret()
  // 32-byte master derived via HKDF-Extract; simpler than pulling in a library.
  const base = crypto.createHash("sha256").update(secret).digest()
  // HKDF-Expand (single block is plenty at 32B)
  const info = Buffer.from(`leaddrive:${purpose}`, "utf8")
  return crypto.createHmac("sha256", base).update(info).digest().slice(0, 32)
}

/**
 * Stable, non-reversible identity for transient/raw values. The purpose is
 * domain-separated from encryption keys so a fingerprint cannot be reused as
 * an OAuth/token-encryption primitive.
 */
export function hmacToken(value: string, purpose: string): string {
  return crypto.createHmac("sha256", deriveKey(`hmac:${purpose}`)).update(value, "utf8").digest("hex")
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad ? 4 - pad : 0)
  return Buffer.from(normalized, "base64")
}

export function encryptToken(plaintext: string, purpose = "oauth"): string {
  if (!plaintext) return ""
  const key = deriveKey(purpose)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}:` + base64urlEncode(Buffer.concat([iv, ct, tag]))
}

/**
 * Decrypts an AES-GCM blob. Returns legacy plaintext as-is when there is no
 * version prefix. Throws DecryptError on malformed / tampered ciphertext.
 */
export class DecryptError extends Error {}

export function decryptToken(stored: string, purpose = "oauth"): string {
  if (!stored) return ""
  if (!stored.startsWith(`${VERSION}:`)) {
    return stored
  }
  try {
    const raw = base64urlDecode(stored.slice(VERSION.length + 1))
    if (raw.length < 12 + 16) throw new DecryptError("ciphertext too short")
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(raw.length - 16)
    const ct = raw.subarray(12, raw.length - 16)
    const key = deriveKey(purpose)
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
  } catch (e) {
    if (e instanceof DecryptError) throw e
    throw new DecryptError((e as Error)?.message || "decrypt failed")
  }
}

export function isEncrypted(stored: string): boolean {
  return !!stored && stored.startsWith(`${VERSION}:`)
}
