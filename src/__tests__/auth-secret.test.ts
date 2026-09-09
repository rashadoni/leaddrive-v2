import { describe, expect, it } from "vitest"
import {
  MIN_PRODUCTION_AUTH_SECRET_BYTES,
  requireAuthSecret,
  validateAuthSecret,
} from "@/lib/auth-secret"

describe("auth secret validation", () => {
  it.each([undefined, "", "   ", "secret with spaces", "secret\nwith-newline"])(
    "rejects missing or whitespace-bearing values (%s)",
    (secret) => {
      expect(() => validateAuthSecret(secret, "development")).toThrow(/NEXTAUTH_SECRET/)
    },
  )

  it.each([
    "change-me-in-production",
    "dev-secret-change-in-production",
    "ld-dev-fallback-secret-change-me",
    "ld-fallback-secret-change-me",
    "your-secret-here",
  ])("rejects the production placeholder %s", (secret) => {
    expect(() => validateAuthSecret(secret, "production")).toThrow(/placeholder/)
  })

  it("rejects short and low-diversity production values without echoing them", () => {
    const shortSecret = "short-local-secret"
    const repeatedSecret = "a".repeat(MIN_PRODUCTION_AUTH_SECRET_BYTES)

    expect(() => validateAuthSecret(shortSecret, "production")).toThrow(/at least 32 bytes/)
    expect(() => validateAuthSecret(repeatedSecret, "production")).toThrow(/diversity/)
    try {
      validateAuthSecret(shortSecret, "production")
    } catch (error) {
      expect(String(error)).not.toContain(shortSecret)
    }
  })

  it("accepts a generated-strength production value unchanged", () => {
    const secret = "Q4u8Nw2yR6p0L3k7V9x1C5m8B2s6H0z4K7j9" // gitleaks:allow -- synthetic test/public display literal
    expect(validateAuthSecret(secret, "production")).toBe(secret)
    expect(requireAuthSecret({ NEXTAUTH_SECRET: secret, NODE_ENV: "production" })).toBe(secret)
  })

  it("allows a short explicit local test value outside production", () => {
    expect(validateAuthSecret("local-test-secret", "test")).toBe("local-test-secret")
    expect(validateAuthSecret("local-dev-secret", "development")).toBe("local-dev-secret")
  })
})
