import { afterEach, describe, expect, it } from "vitest"

import { decryptToken, encryptToken, isEncrypted } from "@/lib/secure-token"

const mutableEnv = process.env as Record<string, string | undefined>

const ORIGINAL_ENV = {
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NODE_ENV: process.env.NODE_ENV,
}

afterEach(() => {
  if (ORIGINAL_ENV.NEXTAUTH_SECRET === undefined) {
    delete mutableEnv.NEXTAUTH_SECRET
  } else {
    mutableEnv.NEXTAUTH_SECRET = ORIGINAL_ENV.NEXTAUTH_SECRET
  }
  if (ORIGINAL_ENV.NODE_ENV === undefined) {
    delete mutableEnv.NODE_ENV
  } else {
    mutableEnv.NODE_ENV = ORIGINAL_ENV.NODE_ENV
  }
})

describe("secure token encryption", () => {
  it("round-trips encrypted tokens with NEXTAUTH_SECRET", () => {
    mutableEnv.NODE_ENV = "production"
    mutableEnv.NEXTAUTH_SECRET = "test-secret-with-enough-entropy-for-token-tests"

    const stored = encryptToken("access-token", "oauth:test")

    expect(isEncrypted(stored)).toBe(true)
    expect(decryptToken(stored, "oauth:test")).toBe("access-token")
  })

  it("fails closed in production when NEXTAUTH_SECRET is missing", () => {
    mutableEnv.NODE_ENV = "production"
    delete mutableEnv.NEXTAUTH_SECRET

    expect(() => encryptToken("access-token", "oauth:test")).toThrow(/NEXTAUTH_SECRET/)
  })

  it("keeps legacy plaintext fallback only for non-production compatibility", () => {
    mutableEnv.NODE_ENV = "test"
    delete mutableEnv.NEXTAUTH_SECRET

    const stored = encryptToken("access-token", "oauth:test")

    expect(isEncrypted(stored)).toBe(true)
    expect(decryptToken(stored, "oauth:test")).toBe("access-token")
    expect(decryptToken("legacy-token", "oauth:test")).toBe("legacy-token")
  })
})
