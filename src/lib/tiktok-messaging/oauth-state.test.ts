import { afterEach, describe, expect, it, vi } from "vitest"
import { createMessagingState, messagingStateFingerprint, verifyMessagingState } from "./oauth-state"

afterEach(() => vi.unstubAllEnvs())
describe("TikTok OAuth state", () => {
  it("binds user and tenant with unique nonces and a non-reversible server fingerprint", () => {
    const state = createMessagingState("tenantA", "adminA", 1000)
    expect(verifyMessagingState(state, 2000)).toMatchObject({ organizationId: "tenantA", userId: "adminA", issuedAt: 1000 })
    expect(state).not.toEqual(createMessagingState("tenantA", "adminA", 1000))
    expect(messagingStateFingerprint(state)).toMatch(/^oauth-state:[a-f0-9]{64}$/)
    expect(messagingStateFingerprint(state)).not.toContain("tenantA")
  })
  it("rejects altered payloads, malformed signatures, expired and future state", () => {
    const state = createMessagingState("tenantA", "adminA", 1000)
    const [payload, signature] = state.split(".")
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), organizationId: "tenantB" })).toString("base64url")
    expect(verifyMessagingState(`${changed}.${signature}`, 2000)).toBeNull()
    expect(verifyMessagingState(`${payload}.bad`, 2000)).toBeNull()
    expect(verifyMessagingState(state, 601001)).toBeNull()
    expect(verifyMessagingState(state, 999)).toBeNull()
  })
  it("fails closed without the encryption/signing secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(() => createMessagingState("a", "b")).toThrow()
    expect(verifyMessagingState("x")).toBeNull()
  })
})
