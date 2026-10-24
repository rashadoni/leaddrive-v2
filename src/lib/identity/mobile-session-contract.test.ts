import { describe, expect, it } from "vitest"
import { authorizeIdentityMobileSession as authorize, IDENTITY_MOBILE_AUDIENCES as audience, IDENTITY_MOBILE_ISSUER as issuer,
  type IdentityMobileApplication, type IdentityMobileClaims, type IdentityMobileState } from "./mobile-session-contract"
const now = new Date("2026-10-24T20:00:01.000Z"), issued = Math.floor(now.valueOf() / 1000) - 1
function fixture(app: IdentityMobileApplication = "TIME") {
  const scope = { organizationId: "tenant-a", userId: "person-a" }
  const claims: IdentityMobileClaims = { version: 1, iss: issuer, aud: audience[app], sub: scope.userId, organizationId: scope.organizationId,
    application: app, actorId: "original-actor-a", phoneClaimId: "claim-a", credentialEpoch: 3, grantVersion: 2, membershipVersion: 1, iat: issued, exp: issued + 604800, jti: "session-a" }
  const state: IdentityMobileState = { company: { id: scope.organizationId, isActive: true, identityMobileEnabled: true },
    person: { ...scope, isActive: true, anonymizedAt: null }, account: { ...scope, version: 8, credentialEpoch: 3, cutoverAt: new Date("2026-10-24T19:00:00.000Z") },
    claim: { ...scope, id: "claim-a" }, grant: { ...scope, application: app, status: "ACTIVE", role: app === "TIME" ? "EMPLOYEE" : "AGENT", version: 2 },
    membership: { ...scope, application: app, actorId: "original-actor-a", active: true, version: 1 }, actor: { organizationId: scope.organizationId, userId: scope.userId, id: "original-actor-a", status: "ACTIVE" }, license: { application: app, enabled: true } }
  return { claims, state }
}
describe("future authoritative mobile session policy, inactive until composed", () => {
  it("admits one person/original actor independently in Time and Field with app-specific roles", () => {
    for (const app of ["TIME", "ROUTE_FIELD"] as const) {
      const { claims, state } = fixture(app), context = authorize(claims, app, state, now)
      expect(context?.userId).toBe("person-a"); expect(context?.actorId).toBe("original-actor-a")
      expect(context?.application).toBe(app); expect(context?.role).toBe(app === "TIME" ? "EMPLOYEE" : "AGENT")
      expect(context).not.toHaveProperty("agentId")
    }
  })
  it("does not invalidate Time for a sibling grant/account write, but does revoke the changed grant", () => {
    const time = fixture(), field = fixture("ROUTE_FIELD")
    time.state.account.version++; field.state.account.version++; field.state.grant!.status = "REVOKED"; field.state.grant!.version++
    expect(authorize(time.claims, "TIME", time.state, now)).not.toBeNull()
    expect(authorize(field.claims, "ROUTE_FIELD", field.state, now)).toBeNull()
  })
  it("refuses cross-application audiences, multi-audience tokens, CRM and legacy/setup token shapes", () => {
    const { claims, state } = fixture()
    for (const changed of [{ ...claims, aud: audience.ROUTE_FIELD }, { ...claims, aud: [audience.TIME, audience.ROUTE_FIELD] },
      { ...claims, application: "CRM" }, { ...claims, agentId: "original-actor-a" }, { ...claims, role: "ADMIN" },
      { ...claims, accountVersion: 8 }, "lds1.key.proof.signature", { agentId: "original-actor-a", orgId: "tenant-a" }]) expect(authorize(changed, "TIME", state, now)).toBeNull()
    expect(authorize(claims, "ROUTE_FIELD", state, now)).toBeNull()
    expect(authorize(claims, "CRM" as IdentityMobileApplication, state, now)).toBeNull()
  })
  it("never treats staged data, disabled rollout/company or inactive/anonymized person as authorization", () => {
    for (const kind of ["stage", "flag", "company", "person", "anonymized"]) {
      const { claims, state } = fixture()
      if (kind === "stage") state.account.cutoverAt = null
      if (kind === "flag") state.company.identityMobileEnabled = false
      if (kind === "company") state.company.isActive = false
      if (kind === "person") state.person.isActive = false
      if (kind === "anonymized") state.person.anonymizedAt = now
      expect(authorize(claims, "TIME", state, now)).toBeNull()
    }
  })
  it("refuses missing license/membership/grant and a Field role in Time", () => {
    for (const kind of ["license", "membership", "inactive-membership", "grant", "role", "grant-version"]) {
      const { claims, state } = fixture()
      if (kind === "license") state.license.enabled = false
      if (kind === "membership") state.membership = null
      if (kind === "inactive-membership") state.membership!.active = false
      if (kind === "grant") state.grant = null
      if (kind === "role") state.grant!.role = "AGENT"
      if (kind === "grant-version") state.grant!.version++
      expect(authorize(claims, "TIME", state, now)).toBeNull()
    }
    const field = fixture("ROUTE_FIELD"); field.state.grant!.role = "EMPLOYEE"
    expect(authorize(field.claims, "ROUTE_FIELD", field.state, now)).toBeNull()
  })
  it("binds every fresh record to the tenant/person and original actor", () => {
    for (const name of ["person", "account", "claim", "grant", "membership", "actor"] as const) {
      for (const column of ["organizationId", "userId"] as const) {
        const { claims, state } = fixture(); state[name]![column] = "other"
        expect(authorize(claims, "TIME", state, now)).toBeNull()
      }
    }
    const { claims, state } = fixture(); state.membership!.actorId = "different-actor"
    expect(authorize(claims, "TIME", state, now)).toBeNull()
  })
  it("does not revive a token after membership reactivation or an actor link change", () => {
    const { claims, state } = fixture()
    state.membership!.active = false; expect(authorize(claims, "TIME", state, now)).toBeNull()
    state.membership!.active = true; state.membership!.version++
    expect(authorize(claims, "TIME", state, now)).toBeNull()
    state.membership!.version--; state.actor!.userId = null
    expect(authorize(claims, "TIME", state, now)).toBeNull()
    state.actor!.userId = "person-a"; state.actor!.status = "INACTIVE"
    expect(authorize(claims, "TIME", state, now)).toBeNull()
  })
  it("revokes a previous credential epoch/phone claim without transferring an actor or granting another app", () => {
    const { claims, state } = fixture()
    state.account.credentialEpoch++; expect(authorize(claims, "TIME", state, now)).toBeNull()
    state.account.credentialEpoch--; state.claim!.id = "new-owner-claim"; expect(authorize(claims, "TIME", state, now)).toBeNull()
  })
  it("enforces exact expiry, issue/cutover bounds, maximum lifetime and integer versions", () => {
    const { claims, state } = fixture()
    expect(authorize(claims, "TIME", state, new Date(claims.exp * 1000))).toBeNull()
    expect(authorize(claims, "TIME", state, new Date(claims.exp * 1000 - 1))).not.toBeNull()
    for (const changed of [{ ...claims, iat: issued + 2 }, { ...claims, exp: issued + 604801 }, { ...claims, credentialEpoch: 3.5 },
      { ...claims, grantVersion: 0 }, { ...claims, iss: "other-issuer" }, { ...claims, sub: "person-a\n" }]) expect(authorize(changed, "TIME", state, now)).toBeNull()
    state.account.cutoverAt = new Date("2026-10-24T20:00:01.000Z")
    expect(authorize(claims, "TIME", state, now)).toBeNull()
  })
})
