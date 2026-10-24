import { describe, expect, it } from "vitest"
import { credentialSetupHint, credentialSetupRequestHash, mintCredentialSetup, verifyCredentialSetup, type CredentialSetupContext } from "./credential-setup"

const context = (): CredentialSetupContext => ({ organizationId: "tenant-a", userId: "person-a", proofId: "proof-a", claimId: "claim-a", accountVersion: 2, credentialEpoch: 2,
  confirmedAt: "2026-10-24T20:00:00.000Z", expiresAt: "2026-10-24T20:10:00.000Z" })
const key = { id: "synthetic-setup-key", material: new Uint8Array(32).fill(19) }
const now = new Date("2026-10-24T20:00:01.000Z")

describe("narrow credential setup capability, not an authentication session", () => {
  it("replays the same frozen capability without exposing scope, credentials or grants", () => {
    const token = mintCredentialSetup(context(), key, now)
    expect(mintCredentialSetup(context(), key, now)).toBe(token)
    expect(verifyCredentialSetup(context(), key, token, now)).toBe(true)
    expect(credentialSetupHint(token)).toEqual({ keyId: key.id, proofId: "proof-a" })
    for (const text of ["person-a", "tenant-a", "claim-a", "CRM", "agentId", "password"]) expect(token).not.toContain(text)
    expect(token.split(".")).toHaveLength(4)
  })
  it("binds every confirmed scope, claim, epoch and fixed deadline", () => {
    const original = context(), token = mintCredentialSetup(original, key, now)
    for (const [name, value] of Object.entries(original)) {
      const changed = { ...original, [name]: typeof value === "number" ? value + 1 : name === "confirmedAt" ? "2026-10-24T20:00:00.001Z" : name === "expiresAt" ? "2026-10-24T20:09:59.999Z" : `${value}-other` }
      expect(verifyCredentialSetup(changed, key, token, now)).toBe(false)
    }
  })
  it("rejects the exact expiry instant and pre-confirmation time", () => {
    const token = mintCredentialSetup(context(), key, now)
    for (const at of [new Date(context().expiresAt), new Date("2026-10-24T19:59:59.999Z")]) {
      expect(verifyCredentialSetup(context(), key, token, at)).toBe(false)
      expect(() => mintCredentialSetup(context(), key, at)).toThrow("IDENTITY_SETUP_EXPIRED")
    }
    expect(verifyCredentialSetup(context(), key, token, new Date(context().confirmedAt))).toBe(true)
    expect(() => verifyCredentialSetup(context(), key, token, new Date("bad"))).toThrow("IDENTITY_SETUP_CLOCK_INVALID")
  })
  it("rejects a changed key ID, secret, token character or alternate encoding", () => {
    const token = mintCredentialSetup(context(), key, now)
    expect(verifyCredentialSetup(context(), { ...key, id: "renamed-key" }, token, now)).toBe(false)
    expect(verifyCredentialSetup(context(), { ...key, material: new Uint8Array(32).fill(20) }, token, now)).toBe(false)
    for (const value of [token + "\n", token + "=", token.replace("lds1", "lds2"), token.slice(0, -1), "x".repeat(321)]) expect(verifyCredentialSetup(context(), key, value, now)).toBe(false)
    for (const value of [token + "\n", token + "=", "", "x".repeat(321), token.replace("cHJvb2YtYQ", "cHJvb2YtYR")]) expect(credentialSetupHint(value)).toBeNull()
  })
  it("refuses malformed context/key rather than minting a broader capability", () => {
    for (const changed of [{ ...context(), application: "CRM" }, { ...context(), accountVersion: 0 }, { ...context(), credentialEpoch: 1.5 },
      { ...context(), expiresAt: "2026-10-24T20:11:00.000Z" }, { ...context(), confirmedAt: "2026-10-24T20:00:00Z" }]) expect(() => mintCredentialSetup(changed, key, now)).toThrow("IDENTITY_SETUP_CONTEXT_INVALID")
    for (const changed of [{ ...key, id: "key\n" }, { ...key, material: new Uint8Array(31) }]) expect(() => mintCredentialSetup(context(), changed, now)).toThrow("IDENTITY_SETUP_KEY_INVALID")
  })
  it("uses a separate keyed fingerprint for exact request/password idempotency", () => {
    const hash = credentialSetupRequestHash(context(), key, "request-1", "Synthetic!Password47")
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(credentialSetupRequestHash(context(), key, "request-1", "Synthetic!Password47")).toBe(hash)
    expect(credentialSetupRequestHash(context(), key, "request-2", "Synthetic!Password47")).not.toBe(hash)
    expect(credentialSetupRequestHash(context(), key, "request-1", "Synthetic!Password48")).not.toBe(hash)
    expect(credentialSetupRequestHash({ ...context(), credentialEpoch: 3 }, key, "request-1", "Synthetic!Password47")).not.toBe(hash)
    expect(() => credentialSetupRequestHash(context(), key, "request-1", "あ".repeat(25))).toThrow("IDENTITY_SETUP_INPUT_INVALID")
  })
})
