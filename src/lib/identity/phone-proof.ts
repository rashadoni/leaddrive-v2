import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import { assertIdentityRequestId, assertIdentityScope, IdentityRegistryError, normalizeIdentityPhone } from "./contract.js"

/** Node/server primitive only; never a login token or a grant decision. */
export type PhoneProofContext = {
  organizationId: string
  userId: string
  reservationId: string
  challengeId: string
  normalizedPhone: string
  accountVersion: number
  credentialEpoch: number
  createdAt: string
  expiresAt: string
}
export type PhoneProofKey = { id: string; material: Uint8Array }
export type SealedPhoneProof = { keyId: string; codeHash: string; deliveryCiphertext: string }
const PURPOSE = "leaddrive:identity:phone-possession:v1"
const CONTEXT_KEYS = ["organizationId", "userId", "reservationId", "challengeId", "normalizedPhone", "accountVersion", "credentialEpoch", "createdAt", "expiresAt"]

function instant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return Number.NaN
  const date = new Date(value)
  return Number.isFinite(date.valueOf()) && date.toISOString() === value ? date.valueOf() : Number.NaN
}

function contextBytes(context: PhoneProofContext): Buffer {
  if (!context || typeof context !== "object" || Array.isArray(context)
    || Object.keys(context).length !== CONTEXT_KEYS.length || CONTEXT_KEYS.some(key => !Object.hasOwn(context, key))) {
    throw new IdentityRegistryError("IDENTITY_PROOF_CONTEXT_INVALID")
  }
  assertIdentityScope(context.organizationId, context.userId)
  assertIdentityRequestId(context.reservationId); assertIdentityRequestId(context.challengeId)
  const created = instant(context.createdAt), expires = instant(context.expiresAt)
  if (typeof context.normalizedPhone !== "string" || normalizeIdentityPhone(context.normalizedPhone) !== context.normalizedPhone
    || ![context.accountVersion, context.credentialEpoch].every(value => Number.isInteger(value) && value > 0 && value <= 2_147_483_647)
    || !Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires - created > 600_000) {
    throw new IdentityRegistryError("IDENTITY_PROOF_CONTEXT_INVALID")
  }
  return Buffer.from(JSON.stringify([PURPOSE, context.organizationId, context.userId, context.reservationId, context.challengeId,
    context.normalizedPhone, context.accountVersion, context.credentialEpoch, context.createdAt, context.expiresAt]), "utf8")
}

function validKeyId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 40 && !/[^A-Za-z0-9_-]/.test(value)
}

function keys(key: PhoneProofKey) {
  if (!key || !validKeyId(key.id)
    || !(key.material instanceof Uint8Array) || key.material.byteLength !== 32) throw new IdentityRegistryError("IDENTITY_PROOF_KEY_INVALID")
  const root = Buffer.from(key.material)
  try {
    return { mac: Buffer.from(hkdfSync("sha256", root, PURPOSE, `code-mac/v1/${key.id}`, 32)), encryption: Buffer.from(hkdfSync("sha256", root, PURPOSE, `delivery-encryption/v1/${key.id}`, 32)) }
  } finally { root.fill(0) }
}

function active(context: PhoneProofContext, at: Date) {
  if (!(at instanceof Date) || !Number.isFinite(at.valueOf())) throw new IdentityRegistryError("IDENTITY_PROOF_CLOCK_INVALID")
  return at.valueOf() >= instant(context.createdAt) && at.valueOf() < instant(context.expiresAt)
}
function codeMac(aad: Buffer, code: Buffer, key: Buffer) {
  return createHmac("sha256", key).update(aad).update(Buffer.from([0])).update(code).digest()
}
function recordValid(proof: SealedPhoneProof): boolean {
  return !!proof && typeof proof === "object" && validKeyId(proof.keyId)
    && typeof proof.codeHash === "string" && proof.codeHash.length === 64 && /^[a-f0-9]{64}$/.test(proof.codeHash)
    && typeof proof.deliveryCiphertext === "string" && proof.deliveryCiphertext.length <= 128
}

/**
 * Generate one six-digit secret with crypto.randomInt and seal it for a trusted
 * delivery worker. No plaintext code is returned to the issuing caller.
 * Persistence, resend/rate limits, attempts and one-time consumption belong to
 * the transaction service, not this primitive. No HTTP/provider call occurs.
 */
export function sealPhoneProof(context: PhoneProofContext, key: PhoneProofKey): SealedPhoneProof {
  const aad = contextBytes(context), derived = keys(key)
  const code = Buffer.from(randomInt(0, 1_000_000).toString().padStart(6, "0"), "ascii")
  try {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", derived.encryption, iv, { authTagLength: 16 })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(code), cipher.final()]), tag = cipher.getAuthTag()
    return { keyId: key.id, codeHash: codeMac(aad, code, derived.mac).toString("hex"),
      deliveryCiphertext: ["v1", key.id, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".") }
  } finally { code.fill(0); aad.fill(0); derived.mac.fill(0); derived.encryption.fill(0) }
}

/** `at` must be trusted current server/database time, never a request value. */
export function verifyPhoneProofCode(context: PhoneProofContext, proof: SealedPhoneProof, key: PhoneProofKey, code: string, at: Date): boolean {
  const aad = contextBytes(context), derived = keys(key)
  try {
    if (!active(context, at) || !recordValid(proof) || proof.keyId !== key.id || typeof code !== "string" || code.length !== 6 || !/^[0-9]{6}$/.test(code)) return false
    const entered = Buffer.from(code, "ascii")
    try { return timingSafeEqual(Buffer.from(proof.codeHash, "hex"), codeMac(aad, entered, derived.mac)) }
    finally { entered.fill(0) }
  } finally { aad.fill(0); derived.mac.fill(0); derived.encryption.fill(0) }
}

/**
 * Trusted delivery worker only: decrypt against the exact frozen reservation
 * context, key ID and current server time. Never return this from an endpoint,
 * include it in logs, or treat successful decryption/delivery as possession.
 */
export function openPhoneProofDelivery(context: PhoneProofContext, proof: SealedPhoneProof, key: PhoneProofKey, at: Date): string {
  const aad = contextBytes(context), derived = keys(key)
  let clear: Buffer | undefined
  try {
    if (!active(context, at) || !recordValid(proof) || proof.keyId !== key.id) throw new Error("REFUSED")
    const fields = proof.deliveryCiphertext.split(".")
    if (fields.length !== 5 || fields[0] !== "v1" || fields[1] !== key.id
      || !/^[A-Za-z0-9_-]{16}$/.test(fields[2]) || !/^[A-Za-z0-9_-]{8}$/.test(fields[3]) || !/^[A-Za-z0-9_-]{22}$/.test(fields[4])) throw new Error("REFUSED")
    const [iv, ciphertext, tag] = fields.slice(2).map(value => Buffer.from(value, "base64url"))
    if ([iv, ciphertext, tag].some((value, index) => value.toString("base64url") !== fields[index + 2])) throw new Error("REFUSED")
    const decipher = createDecipheriv("aes-256-gcm", derived.encryption, iv, { authTagLength: 16 })
    decipher.setAAD(aad); decipher.setAuthTag(tag)
    clear = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    if (clear.length !== 6 || !clear.every(value => value >= 48 && value <= 57)) throw new Error("REFUSED")
    const code = clear.toString("ascii")
    if (!/^\d{6}$/.test(code) || !timingSafeEqual(Buffer.from(proof.codeHash, "hex"), codeMac(aad, clear, derived.mac))) throw new Error("REFUSED")
    return code
  } catch { throw new IdentityRegistryError("IDENTITY_PROOF_DELIVERY_REFUSED") }
  finally { clear?.fill(0); aad.fill(0); derived.mac.fill(0); derived.encryption.fill(0) }
}
