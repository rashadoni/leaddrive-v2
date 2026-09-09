import { describe, expect, it } from "vitest"
import {
  createSessionFingerprint,
  hasCurrentSessionFingerprint,
} from "@/lib/session-invalidation"

const SECRET = "test-session-secret"

function fingerprint(overrides: Partial<Parameters<typeof createSessionFingerprint>[0]> = {}) {
  return createSessionFingerprint({
    principalId: "user-1",
    passwordHash: "$2b$12$old-password-hash",
    passwordChangedAt: new Date("2026-08-11T12:00:00.123Z"),
    secret: SECRET,
    ...overrides,
  })
}

describe("session credential fingerprints", () => {
  it("is stable for the exact same DB credential state", () => {
    expect(fingerprint()).toBe(fingerprint())
  })

  it("changes when a password write produces a new bcrypt hash", () => {
    expect(fingerprint({ passwordHash: "$2b$12$new-password-hash" }))
      .not.toBe(fingerprint())
  })

  it("changes for a millisecond-precision logout-all cutoff", () => {
    expect(fingerprint({ passwordChangedAt: new Date("2026-08-11T12:00:00.124Z") }))
      .not.toBe(fingerprint())
  })

  it("has no same-second iat boundary: pre/post-change states never match", () => {
    const before = fingerprint({
      passwordHash: "$2b$12$before",
      passwordChangedAt: new Date("2026-08-11T12:00:00.100Z"),
    })
    const after = fingerprint({
      passwordHash: "$2b$12$after",
      passwordChangedAt: new Date("2026-08-11T12:00:00.900Z"),
    })

    expect(hasCurrentSessionFingerprint(before, after)).toBe(false)
  })

  it("binds the epoch to the principal and signing secret", () => {
    expect(fingerprint({ principalId: "user-2" })).not.toBe(fingerprint())
    expect(fingerprint({ secret: "rotated-secret" })).not.toBe(fingerprint())
  })

  it("fails closed for legacy, malformed, and stale token claims", () => {
    const current = fingerprint()
    expect(hasCurrentSessionFingerprint(undefined, current)).toBe(false)
    expect(hasCurrentSessionFingerprint(null, current)).toBe(false)
    expect(hasCurrentSessionFingerprint("", current)).toBe(false)
    expect(hasCurrentSessionFingerprint(fingerprint({ passwordHash: "stale" }), current)).toBe(false)
    expect(hasCurrentSessionFingerprint(current, current)).toBe(true)
  })

  it("rejects invalid credential state instead of minting a permissive claim", () => {
    expect(() => fingerprint({ secret: "" })).toThrow("secret")
    expect(() => fingerprint({ principalId: "" })).toThrow("principalId")
    expect(() => fingerprint({ passwordChangedAt: new Date("invalid") })).toThrow("passwordChangedAt")
  })
})
