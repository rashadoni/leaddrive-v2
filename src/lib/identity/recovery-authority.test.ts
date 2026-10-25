import { describe, expect, it } from "vitest"
import { identityRecoveryAuthorityHash, parseIdentityRecoveryAuthority, type IdentityRecoveryAuthority } from "./recovery-authority"

const authority = (): IdentityRecoveryAuthority => ({ version: 3, purpose: "COMMON_PASSWORD_RECOVERY", organizationId: "tenant-a", userId: "person-a",
  application: "TIME", claimId: "claim-a", normalizedPhone: "+994550001122", actorId: "time-card", accountVersion: 8, credentialEpoch: 4,
  contactRevision: 2, grantVersion: 3, membershipVersion: 1 })
describe("server-owned recovery eligibility context", () => {
  it("binds company, person, phone claim, selected application and every revocation revision", () => {
    const original = authority(), hash = identityRecoveryAuthorityHash(original)
    expect(parseIdentityRecoveryAuthority(original)).toEqual(original)
    for (const change of [{ organizationId: "tenant-b" }, { userId: "person-b" }, { application: "ROUTE_FIELD" as const },
      { claimId: "claim-b" }, { normalizedPhone: "+994550001123" }, { actorId: "field-card" }, { accountVersion: 9 },
      { credentialEpoch: 5 }, { contactRevision: 3 }, { grantVersion: 4 }, { membershipVersion: 2 }]) {
      expect(identityRecoveryAuthorityHash({ ...original, ...change })).not.toBe(hash)
    }
    expect(identityRecoveryAuthorityHash(Object.fromEntries(Object.entries(original).reverse()) as IdentityRecoveryAuthority)).toBe(hash)
  })
  it("refuses invented purposes, versions, CRM, national phone aliases and incomplete contexts", () => {
    for (const change of [{ version: 2 }, { purpose: "INVITATION" }, { application: "CRM" }, { normalizedPhone: "0550001122" },
      { actorId: null }, { contactRevision: 0 }, { accountVersion: 2_147_483_648 }, { credentialEpoch: 1.5 }, { extra: "unexpected" }]) {
      expect(parseIdentityRecoveryAuthority({ ...authority(), ...change })).toBeNull()
    }
    for (const name of Object.keys(authority())) {
      const partial = { ...authority() } as Record<string, unknown>; delete partial[name]
      expect(parseIdentityRecoveryAuthority(partial)).toBeNull()
    }
  })
})
