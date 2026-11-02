import { describe, expect, it, vi } from "vitest"
import { authenticateIdentityCrmPassword, parseIdentityCrmClaims, resolveIdentityCrmSession } from "./crm-session"

const claims = { mode: "IDENTITY_CRM_V1", organizationId: "fixture-company", userId: "fixture-user",
  claimId: "fixture-claim", credentialEpoch: 3, grantVersion: 4 }

describe("private canonical CRM authority claims", () => {
  it("copies and freezes the exact server contract without credential data", () => {
    const input = { ...claims }
    const parsed = parseIdentityCrmClaims(input)
    expect(parsed).toEqual(claims)
    expect(Object.isFrozen(parsed)).toBe(true)
    input.credentialEpoch++
    expect(parsed?.credentialEpoch).toBe(3)
    expect(JSON.stringify(parsed)).not.toMatch(/password|phone|role|token/i)
  })
  it.each([
    null, [], {}, { ...claims, mode: "TIME" }, { ...claims, mode: "LEGACY" },
    { ...claims, role: "admin" }, { ...claims, accountVersion: 4 }, { ...claims, passwordHash: "extra" },
    { ...claims, organizationId: "../foreign" }, { ...claims, userId: "" }, { ...claims, claimId: "bad/claim" },
    { ...claims, credentialEpoch: 0 }, { ...claims, credentialEpoch: "3" },
    { ...claims, grantVersion: -1 }, { ...claims, grantVersion: 2.5 },
    { ...claims, grantVersion: 2_147_483_648 }, { ...claims, grantVersion: Number.NaN },
  ])("rejects malformed, cross-purpose or caller-supplied authority: %j", value => {
    expect(parseIdentityCrmClaims(value)).toBeNull()
  })
  it("rejects a wrong subject/tenant or invalid hint before opening a snapshot", async () => {
    const client = { $transaction: vi.fn(async () => { throw new Error("must not open") }) }
    expect(await resolveIdentityCrmSession(client as never, "foreign-company", claims.userId, claims)).toBeNull()
    expect(await resolveIdentityCrmSession(client as never, claims.organizationId, "foreign-user", claims)).toBeNull()
    expect(await resolveIdentityCrmSession(client as never, claims.organizationId, claims.userId, { ...claims, role: "admin" })).toBeNull()
    expect(client.$transaction).not.toHaveBeenCalled()
  })
  it("bounds bcrypt input by bytes and refuses invalid server scope without database work", async () => {
    const client = { $transaction: vi.fn(async () => { throw new Error("must not open") }) }
    for (const password of ["", "x".repeat(73), "😀".repeat(19)]) {
      expect(await authenticateIdentityCrmPassword(client as never, claims.organizationId, claims.userId, password)).toBeNull()
    }
    expect(await authenticateIdentityCrmPassword(client as never, "bad/company", claims.userId, "Fictional!Password47")).toBeNull()
    expect(client.$transaction).not.toHaveBeenCalled()
  })
  it("never authorizes a database failure", async () => {
    const client = { $transaction: vi.fn(async () => { throw new Error("private database failure") }) }
    expect(await authenticateIdentityCrmPassword(client as never, claims.organizationId, claims.userId, "Fictional!Password47")).toBeNull()
    expect(await resolveIdentityCrmSession(client as never, claims.organizationId, claims.userId, claims)).toBeNull()
    expect(client.$transaction).toHaveBeenCalledTimes(2)
  })
})
