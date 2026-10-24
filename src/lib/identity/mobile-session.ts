import { hkdfSync, randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"
import { IdentityRegistryError } from "./contract.js"
import { authorizeIdentityMobileSession, IDENTITY_MOBILE_AUDIENCES, IDENTITY_MOBILE_ISSUER,
  type IdentityMobileApplication, type IdentityMobileClaims, type IdentityMobileState } from "./mobile-session-contract.js"

export type IdentitySessionSigningKey = { purpose: "IDENTITY_MOBILE_SESSION"; id: string; material: Uint8Array }
export type IdentitySessionKeyResolver = (keyId: string) => IdentitySessionSigningKey | null
const TYPE = "leaddrive-mobile+jwt", PURPOSE = "leaddrive:identity:mobile-session:v1"
function validKeyId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 40 && !/[^A-Za-z0-9_-]/.test(value)
}
function withSigningKey<T>(key: IdentitySessionSigningKey, work: (derived: Buffer) => T): T {
  if (!key || key.purpose !== "IDENTITY_MOBILE_SESSION" || !validKeyId(key.id)
    || !(key.material instanceof Uint8Array) || key.material.byteLength !== 32) throw new IdentityRegistryError("IDENTITY_SESSION_KEY_INVALID")
  const root = Buffer.from(key.material)
  let derived: Buffer | undefined
  try { derived = Buffer.from(hkdfSync("sha256", root, PURPOSE, `jwt-signing/v1/${key.id}`, 32)); return work(derived) }
  finally { root.fill(0); derived?.fill(0) }
}
/**
 * Internal composition AFTER actual credential authentication, never after a
 * bare admin lookup or setup-token decode. State must be freshly tenant-scoped.
 * No current login calls this signer. Configure a dedicated identity root;
 * there is no JWT_SECRET/env fallback. HKDF also separates this JWT MAC from
 * OTP/setup keys and legacy raw-secret signatures if a caller misconfigures it.
 */
export function issueIdentityMobileSession(state: IdentityMobileState, application: IdentityMobileApplication, key: IdentitySessionSigningKey, now: Date) {
  if (!["TIME", "ROUTE_FIELD"].includes(application) || !(now instanceof Date) || !Number.isFinite(now.valueOf())
    || !state?.company || !state.person || !state.account || !state.claim || !state.grant || !state.membership || !state.actor) throw new IdentityRegistryError("IDENTITY_SESSION_FORBIDDEN")
  const iat = Math.floor(now.valueOf() / 1000)
  const claims: IdentityMobileClaims = { version: 1, iss: IDENTITY_MOBILE_ISSUER, aud: IDENTITY_MOBILE_AUDIENCES[application],
    sub: state.person.userId, organizationId: state.company.id, application, actorId: state.actor.id, phoneClaimId: state.claim.id,
    credentialEpoch: state.account.credentialEpoch, grantVersion: state.grant.version, membershipVersion: state.membership.version,
    iat, exp: iat + 604_800, jti: randomUUID() }
  if (!authorizeIdentityMobileSession(claims, application, state, now)) throw new IdentityRegistryError("IDENTITY_SESSION_FORBIDDEN")
  return withSigningKey(key, derived => jwt.sign(claims, derived, { algorithm: "HS256", header: { alg: "HS256", typ: TYPE, kid: key.id } }))
}
/**
 * Server-selected expected app, fresh tenant state and server-owned bounded key
 * resolver. Unverified kid is only an allowlisted key-ring lookup hint: no URL,
 * file, DB query or algorithm can be selected by an incoming header.
 */
export function verifyIdentityMobileSession(token: string, application: IdentityMobileApplication, state: IdentityMobileState,
  resolve: IdentitySessionKeyResolver, now: Date) {
  try {
    if (typeof token !== "string" || token.length < 1 || token.length > 4096 || !["TIME", "ROUTE_FIELD"].includes(application)
      || !(now instanceof Date) || !Number.isFinite(now.valueOf())) return null
    const unverified = jwt.decode(token, { complete: true })
    if (!unverified || typeof unverified !== "object") return null
    const header = unverified.header
    if (Object.keys(header).length !== 3 || !["alg", "typ", "kid"].every(name => Object.hasOwn(header, name))
      || header.alg !== "HS256" || header.typ !== TYPE || !validKeyId(header.kid)) return null
    const key = resolve(header.kid)
    if (!key || key.id !== header.kid) return null
    const claims = withSigningKey(key, derived => jwt.verify(token, derived, { algorithms: ["HS256"], issuer: IDENTITY_MOBILE_ISSUER,
      audience: IDENTITY_MOBILE_AUDIENCES[application], clockTimestamp: Math.floor(now.valueOf() / 1000), clockTolerance: 0 }))
    return authorizeIdentityMobileSession(claims, application, state, now)
  } catch { return null }
}
