import { describe, expect, it } from "vitest"
import { identityRuntimeKeys } from "./runtime-keys"
const key = "2a".repeat(32), old = "3b".repeat(32)
const configuration = JSON.stringify({ active: "current", keys: { current: key, retained: old } })
describe("identity runtime key admission", () => {
  it("keeps missing configuration disabled, without falling back to other secrets", () => {
    expect(identityRuntimeKeys({})).toEqual({ mobile: null, proof: null })
  })
  it("signs with the active dedicated key and verifies only retained allowlisted IDs", () => {
    const ring = identityRuntimeKeys({ IDENTITY_MOBILE_SESSION_KEYS: configuration }).mobile!
    expect(ring.active.id).toBe("current")
    expect(ring.active.purpose).toBe("IDENTITY_MOBILE_SESSION")
    expect(ring.resolve("retained")?.material).toEqual(Buffer.from(old, "hex"))
    for (const id of ["missing", "../../secret", "https://example.invalid/key", "__proto__"]) expect(ring.resolve(id)).toBeNull()
  })
  it.each(["invalid-json", JSON.stringify({ active: "missing", keys: { current: key } }),
    JSON.stringify({ active: "current", keys: { current: "00".repeat(32) } }),
    JSON.stringify({ active: "current", keys: { current: key }, secret: "extra" }),
    JSON.stringify({ active: "current", keys: { current: key, b: key, c: key, d: key } }),
    JSON.stringify({ active: "current", keys: { current: "short" } })])("rejects malformed configuration without disclosing its value", value => {
    expect(() => identityRuntimeKeys({ IDENTITY_MOBILE_SESSION_KEYS: value })).toThrow("IDENTITY_RUNTIME_KEY_CONFIGURATION_INVALID")
  })
  it("refuses material shared between phone proofs and application sessions", () => {
    expect(() => identityRuntimeKeys({ IDENTITY_MOBILE_SESSION_KEYS: configuration, IDENTITY_PHONE_PROOF_KEYS: JSON.stringify({ active: "proof", keys: { proof: old } }) })).toThrow("IDENTITY_RUNTIME_KEY_PURPOSE_COLLISION")
  })
})
