import { describe, expect, it, vi } from "vitest"
import jwt from "jsonwebtoken"
import { issueIdentityMobileSession as issue, verifyIdentityMobileSession as verify, type IdentitySessionSigningKey } from "./mobile-session"
import type { IdentityMobileApplication, IdentityMobileState } from "./mobile-session-contract"
const now = new Date("2026-10-24T20:00:01.000Z")
const key: IdentitySessionSigningKey = { purpose: "IDENTITY_MOBILE_SESSION", id: "synthetic-session-key", material: new Uint8Array(32).fill(29) }
const resolve = (id: string) => id === key.id ? key : null
function state(app: IdentityMobileApplication = "TIME"): IdentityMobileState {
  const scope = { organizationId: "tenant-a", userId: "person-a" }
  return { company: { id: scope.organizationId, isActive: true, identityMobileEnabled: true }, person: { ...scope, isActive: true, anonymizedAt: null },
    account: { ...scope, version: 7, credentialEpoch: 4, cutoverAt: new Date("2026-10-24T19:00:00.000Z") }, claim: { ...scope, id: "claim-a" },
    grant: { ...scope, application: app, status: "ACTIVE", role: app === "TIME" ? "EMPLOYEE" : "AGENT", version: 2 },
    membership: { ...scope, application: app, actorId: "original-actor-a", active: true, version: 1 }, binding: { ...scope, actorId: "original-actor-a", status: "REVIEWED" }, actor: { ...scope, id: "original-actor-a", status: "ACTIVE" },
    license: { application: app, enabled: true } }
}
describe("dedicated identity JWT, unused by current login", () => {
  it("signs/verifies real JWTs for independent apps with pinned profile and original actor", () => {
    for (const app of ["TIME", "ROUTE_FIELD"] as const) {
      const fresh = state(app), token = issue(fresh, app, key, now), decoded = jwt.decode(token, { complete: true })!
      expect(decoded.header).toEqual({ alg: "HS256", typ: "leaddrive-mobile+jwt", kid: key.id })
      expect(verify(token, app, fresh, resolve, now)).toMatchObject({ userId: "person-a", actorId: "original-actor-a", application: app, membershipVersion: 1 })
      expect(decoded.payload).not.toHaveProperty("agentId"); expect(decoded.payload).not.toHaveProperty("role")
      expect(decoded.payload).not.toHaveProperty("accountVersion"); expect(decoded.payload).not.toHaveProperty("password")
      expect(issue(fresh, app, key, now)).not.toBe(token)
    }
  })
  it("rejects real signature tampering, wrong/unknown keys and a legacy raw-secret signature", () => {
    const fresh = state(), token = issue(fresh, "TIME", key, now), decoded = jwt.decode(token, { complete: true })!
    const tampered = token.split("."); tampered[2] = (tampered[2][0] === "A" ? "B" : "A") + tampered[2].slice(1)
    expect(verify(tampered.join("."), "TIME", fresh, resolve, now)).toBeNull()
    expect(verify(token, "TIME", fresh, () => ({ ...key, material: new Uint8Array(32).fill(30) }), now)).toBeNull()
    expect(verify(token, "TIME", fresh, () => null, now)).toBeNull()
    const legacy = jwt.sign(decoded.payload as object, Buffer.from(key.material), { algorithm: "HS256", header: decoded.header })
    expect(verify(legacy, "TIME", fresh, resolve, now)).toBeNull()
    expect(() => jwt.verify(token, Buffer.from(key.material), { algorithms: ["HS256"], clockTimestamp: now.valueOf() / 1000 })).toThrow()
  })
  it("rejects another app/tenant, setup capability and CRM even with a valid signed token", () => {
    const fresh = state(), token = issue(fresh, "TIME", key, now)
    expect(verify(token, "ROUTE_FIELD", state("ROUTE_FIELD"), resolve, now)).toBeNull()
    const foreign = state(); foreign.company.id = "tenant-b"
    expect(verify(token, "TIME", foreign, resolve, now)).toBeNull()
    expect(verify("lds1.key.proof.signature", "TIME", fresh, resolve, now)).toBeNull()
    expect(verify(token, "CRM" as IdentityMobileApplication, fresh, resolve, now)).toBeNull()
  })
  it("refuses unsafe headers before invoking any key resolver", () => {
    const claims = jwt.decode(issue(state(), "TIME", key, now)) as object
    for (const header of [{ alg: "HS256", typ: "JWT", kid: key.id }, { alg: "HS256", typ: "leaddrive-mobile+jwt", kid: "https://untrusted.invalid/key" },
      { alg: "HS256", typ: "leaddrive-mobile+jwt", kid: key.id, jku: "https://untrusted.invalid/key" }]) {
      const token = jwt.sign(claims, "synthetic-unrelated-key", { algorithm: "HS256", header }), resolver = vi.fn(resolve)
      expect(verify(token, "TIME", state(), resolver, now)).toBeNull(); expect(resolver).not.toHaveBeenCalled()
    }
  })
  it("denies staged/disabled membership at issuance and current revocation/expiry at verification", () => {
    const fresh = state(), token = issue(fresh, "TIME", key, now)
    fresh.account.version++; expect(verify(token, "TIME", fresh, resolve, now)).not.toBeNull()
    fresh.membership!.version++; expect(verify(token, "TIME", fresh, resolve, now)).toBeNull()
    fresh.membership!.version--; fresh.account.credentialEpoch++; expect(verify(token, "TIME", fresh, resolve, now)).toBeNull()
    fresh.account.credentialEpoch--; expect(verify(token, "TIME", fresh, resolve, new Date(now.valueOf() + 604800000))).toBeNull()
    fresh.account.cutoverAt = null; expect(() => issue(fresh, "TIME", key, now)).toThrow("IDENTITY_SESSION_FORBIDDEN")
    const revoked = state(); revoked.membership!.active = false
    expect(() => issue(revoked, "TIME", key, now)).toThrow("IDENTITY_SESSION_FORBIDDEN")
  })
  it("has no legacy/default signing key and rejects malformed or incorrectly purposed keys", () => {
    for (const invalid of [{ ...key, material: new Uint8Array(31) }, { ...key, id: "key\n" }, { ...key, purpose: "PHONE_PROOF" }]) {
      expect(() => issue(state(), "TIME", invalid as IdentitySessionSigningKey, now)).toThrow("IDENTITY_SESSION_KEY_INVALID")
    }
    expect(verify("x".repeat(4097), "TIME", state(), resolve, now)).toBeNull()
  })
})
