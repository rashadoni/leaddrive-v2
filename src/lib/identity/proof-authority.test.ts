import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import type { IdentityAdministrator } from "./administrator"
const mocks = vi.hoisted(() => ({ authority: vi.fn() }))
vi.mock("./crm-session", async original => ({ ...await original<typeof import("./crm-session")>(), readIdentityCrmAuthorityInTransaction: mocks.authority }))
import { freezeIdentityProofAuthority, identityProofAuthorityHash, parseIdentityProofAuthority, revalidateIdentityProofAuthority } from "./proof-authority"

const actor: IdentityAdministrator = { organizationId: "fixture-org", userId: "fixture-issuer", mode: "CANONICAL",
  claims: { mode: "IDENTITY_CRM_V1", organizationId: "fixture-org", userId: "fixture-issuer", claimId: "fixture-claim", credentialEpoch: 2, grantVersion: 3 } }
const user = { role: "viewer", passwordHash: "!fixture-old-hash", passwordChangedAt: null, require2fa: false,
  totpEnabled: false, totpSecret: null, smsAuthEnabled: false, verifiedPhone: null }
const findFirst = vi.fn(), query = vi.fn()
const tx = { user: { findFirst }, $queryRaw: query } as unknown as Prisma.TransactionClient
beforeEach(() => {
  vi.resetAllMocks()
  findFirst.mockResolvedValue({ ...user })
  query.mockResolvedValue([{ cutoverAt: new Date("2026-10-25T00:00:00Z") }])
  mocks.authority.mockResolvedValue({ role: "admin", claims: actor.claims })
})

describe("frozen canonical invitation issuer", () => {
  it("uses current CRM authority despite an old viewer role, without storing credentials or MFA secrets", async () => {
    const frozen = await freezeIdentityProofAuthority(tx, actor)
    expect(parseIdentityProofAuthority(frozen)).toEqual(frozen)
    expect(identityProofAuthorityHash(frozen)).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(frozen)).not.toMatch(/fixture-old-hash|totpSecret|passwordHash|verifiedPhone/)
    expect(await revalidateIdentityProofAuthority(tx, frozen, actor.organizationId, actor.userId)).toEqual(frozen)
  })
  it.each([null, { role: "viewer", claims: actor.claims }, { role: "admin", claims: { ...actor.claims, grantVersion: 4 } },
    { role: "admin", claims: { ...actor.claims, credentialEpoch: 3 } }, { role: "admin", claims: { ...actor.claims, claimId: "new-claim" } }])("rejects missing, revoked or replaced CRM authority", async state => {
    mocks.authority.mockResolvedValue(state)
    await expect(freezeIdentityProofAuthority(tx, actor)).rejects.toThrow("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  })
  it.each([{ passwordChangedAt: new Date("2026-10-25T01:00:00Z") }, { require2fa: true }, { totpEnabled: true },
    { totpSecret: "!fictional-new-mfa-state" }, { smsAuthEnabled: true }, { verifiedPhone: "+994507770099" }])("refuses delayed use after issuer security state changes", async change => {
    const frozen = await freezeIdentityProofAuthority(tx, actor)
    findFirst.mockResolvedValue({ ...user, ...change })
    await expect(revalidateIdentityProofAuthority(tx, frozen, actor.organizationId, actor.userId)).rejects.toThrow("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  })
  it("does not reinterpret legacy, foreign or tampered authority as a canonical invitation", async () => {
    const frozen = await freezeIdentityProofAuthority(tx, actor)
    expect(parseIdentityProofAuthority({ ...frozen, administrator: { organizationId: actor.organizationId, userId: actor.userId, mode: "LEGACY" } })).toBeNull()
    expect(parseIdentityProofAuthority({ ...frozen, administrator: { ...actor, role: "admin" } })).toBeNull()
    expect(parseIdentityProofAuthority({ ...frozen, administrator: { ...actor, claims: { ...actor.claims, organizationId: "foreign" } } })).toBeNull()
    await expect(revalidateIdentityProofAuthority(tx, frozen, "foreign", actor.userId)).rejects.toThrow("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
    await expect(revalidateIdentityProofAuthority(tx, frozen, actor.organizationId, "foreign-user")).rejects.toThrow("IDENTITY_PROOF_AUTHORITY_UNAVAILABLE")
  })
})
