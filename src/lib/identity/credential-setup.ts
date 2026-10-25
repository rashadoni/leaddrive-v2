import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"
import { assertIdentityRequestId, assertIdentityScope, IdentityRegistryError } from "./contract"
import type { PhoneProofKey } from "./phone-proof"

/** Frozen server-derived facts AFTER a successful phone confirmation. */
export type CredentialSetupContext = {
  organizationId: string; userId: string; proofId: string; claimId: string;
  accountVersion: number; credentialEpoch: number; confirmedAt: string; expiresAt: string;
  version?: 2; authorityHash?: string; contactRevision?: number;
}
const PURPOSE = "leaddrive:identity:credential-setup:v1"
const NAMES = ["organizationId", "userId", "proofId", "claimId", "accountVersion", "credentialEpoch", "confirmedAt", "expiresAt"]
function instant(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return Number.NaN
  const date = new Date(value)
  return Number.isFinite(date.valueOf()) && date.toISOString() === value ? date.valueOf() : Number.NaN
}
function contextBytes(context: CredentialSetupContext) {
  const names = context?.version === 2 ? [...NAMES, "version", "authorityHash", "contactRevision"] : NAMES
  if (!context || typeof context !== "object" || Array.isArray(context) || Object.keys(context).length !== names.length
    || names.some(name => !Object.hasOwn(context, name))) throw new IdentityRegistryError("IDENTITY_SETUP_CONTEXT_INVALID")
  assertIdentityScope(context.organizationId, context.userId)
  assertIdentityRequestId(context.proofId); assertIdentityRequestId(context.claimId)
  const start = instant(context.confirmedAt), end = instant(context.expiresAt)
  if (![context.accountVersion, context.credentialEpoch].every(n => Number.isInteger(n) && n > 0 && n <= 2_147_483_647)
    || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 600_000) throw new IdentityRegistryError("IDENTITY_SETUP_CONTEXT_INVALID")
  if (context.version === 2 && (typeof context.authorityHash !== "string" || !/^[a-f0-9]{64}$/.test(context.authorityHash)
    || !Number.isInteger(context.contactRevision) || context.contactRevision! < 1 || context.contactRevision! > 2_147_483_647)) throw new IdentityRegistryError("IDENTITY_SETUP_CONTEXT_INVALID")
  return Buffer.from(JSON.stringify([context.version === 2 ? "leaddrive:identity:credential-setup:v2" : PURPOSE, ...names.map(name => context[name as keyof CredentialSetupContext])]), "utf8")
}
function withKey<T>(key: PhoneProofKey, kind: "capability" | "request", work: (derived: Buffer) => T, version = 1): T {
  if (!key || typeof key.id !== "string" || key.id.length < 1 || key.id.length > 40 || /[^A-Za-z0-9_-]/.test(key.id)
    || !(key.material instanceof Uint8Array) || key.material.byteLength !== 32) throw new IdentityRegistryError("IDENTITY_SETUP_KEY_INVALID")
  const root = Buffer.from(key.material)
  let derived: Buffer | undefined
  try { derived = Buffer.from(hkdfSync("sha256", root, `leaddrive:identity:credential-setup:v${version}`, `${kind}/v${version}/${key.id}`, 32)); return work(derived) }
  finally { root.fill(0); derived?.fill(0) }
}
function active(context: CredentialSetupContext, now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new IdentityRegistryError("IDENTITY_SETUP_CLOCK_INVALID")
  return now.valueOf() >= instant(context.confirmedAt) && now.valueOf() < instant(context.expiresAt)
}
function tokenFor(context: CredentialSetupContext, key: PhoneProofKey, bytes: Buffer) {
  return withKey(key, "capability", derived => `lds${context.version ?? 1}.${key.id}.${Buffer.from(context.proofId, "utf8").toString("base64url")}.${createHmac("sha256", derived).update(bytes).digest("base64url")}`, context.version ?? 1)
}
/**
 * Server only, immediately after successful possession. Never mint from an
 * administrator-supplied proof/claim ID. This is deliberately not a JWT or a
 * session: it permits only staged credential setup, no app/CRM/MFA access.
 * The consuming DB transaction must revalidate this entire frozen context and
 * CAS the credential epoch; the codec alone does NOT make a token single-use.
 */
export function mintCredentialSetup(context: CredentialSetupContext, key: PhoneProofKey, now: Date): string {
  const bytes = contextBytes(context)
  try {
    if (!active(context, now)) throw new IdentityRegistryError("IDENTITY_SETUP_EXPIRED")
    return tokenFor(context, key, bytes)
  } finally { bytes.fill(0) }
}
/** Trusted current DB context/time, never context or clock from the request. */
export function verifyCredentialSetup(context: CredentialSetupContext, key: PhoneProofKey, token: string, now: Date): boolean {
  const bytes = contextBytes(context)
  try {
    if (!active(context, now) || typeof token !== "string" || token.length > 320) return false
    const expected = Buffer.from(tokenFor(context, key, bytes), "utf8"), entered = Buffer.from(token, "utf8")
    return expected.length === entered.length && timingSafeEqual(expected, entered)
  } finally { bytes.fill(0) }
}
/** Bounded routing hint only. It conveys no authority and must stay tenant-scoped. */
export function credentialSetupHint(token: string): { keyId: string; proofId: string } | null {
  if (typeof token !== "string" || token.length > 320) return null
  const parts = token.split(".")
  if (parts.length !== 4 || !["lds1", "lds2"].includes(parts[0]) || parts[1].length < 1 || parts[1].length > 40 || /[^A-Za-z0-9_-]/.test(parts[1])
    || parts[2].length < 1 || parts[2].length > 171 || /[^A-Za-z0-9_-]/.test(parts[2]) || parts[3].length !== 43 || /[^A-Za-z0-9_-]/.test(parts[3])) return null
  const decoded = Buffer.from(parts[2], "base64url"), proofId = decoded.toString("utf8")
  if (decoded.toString("base64url") !== parts[2] || !Buffer.from(proofId, "utf8").equals(decoded)) return null
  try { assertIdentityRequestId(proofId) } catch { return null }
  return { keyId: parts[1], proofId }
}
/** Never put an unkeyed password fingerprint in an audit/idempotency receipt. */
export function credentialSetupRequestHash(context: CredentialSetupContext, key: PhoneProofKey, requestId: string, password: string): string {
  assertIdentityRequestId(requestId)
  if (typeof password !== "string" || password.length > 72 || Buffer.byteLength(password, "utf8") > 72) throw new IdentityRegistryError("IDENTITY_SETUP_INPUT_INVALID")
  const bytes = contextBytes(context)
  try { return withKey(key, "request", derived => createHmac("sha256", derived).update(bytes).update(Buffer.from([0])).update(JSON.stringify([requestId, password]), "utf8").digest("hex"), context.version ?? 1) }
  finally { bytes.fill(0) }
}
