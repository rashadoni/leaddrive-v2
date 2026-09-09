import { describe, expect, it } from "vitest"
import { passwordPolicyError } from "@/lib/password-policy"

describe("passwordPolicyError", () => {
  it("rejects missing and non-string values", () => {
    expect(passwordPolicyError(undefined)).toMatch(/required/i)
    expect(passwordPolicyError(123456789012)).toMatch(/required/i)
  })

  it("rejects common compromised passwords even when they meet composition rules", () => {
    expect(passwordPolicyError("Password123!")).toMatch(/breach|common/i)
  })

  it("accepts a strong non-common password", () => {
    expect(passwordPolicyError("Cedar!Orbit-4829")).toBeNull()
  })

  it("enforces the 12-grapheme boundary", () => {
    expect(passwordPolicyError(`Aa1!${"x".repeat(7)}`)).toMatch(/12 characters/)
    expect(passwordPolicyError(`Aa1!${"x".repeat(8)}`)).toBeNull()
  })

  it("does not allow invisible or combining-mark padding", () => {
    expect(passwordPolicyError(`Aa1!${"\u200b".repeat(8)}`)).toMatch(/invisible/i)
    expect(passwordPolicyError(`Aa1!${"\u0301".repeat(8)}`)).toMatch(/12 characters/)
    expect(passwordPolicyError("Cedar Orbit!4829")).toMatch(/whitespace/i)
  })

  it.each([
    ["lowercase1!only", /uppercase/i],
    ["UPPERCASE1!ONLY", /lowercase/i],
    ["NoNumbers!Here", /number/i],
    ["NoSpecial123Here", /special/i],
  ])("rejects a missing composition class", (password, expected) => {
    expect(passwordPolicyError(password)).toMatch(expected)
  })

  it("rejects input beyond bcrypt's 72 UTF-8-byte boundary", () => {
    expect(passwordPolicyError(`Aa1!${"x".repeat(68)}`)).toBeNull()
    expect(passwordPolicyError(`Aa1!${"x".repeat(69)}`)).toMatch(/72 UTF-8 bytes/)
    expect(passwordPolicyError(`Aa1!${"é".repeat(35)}`)).toMatch(/72 UTF-8 bytes/)
    expect(passwordPolicyError(`Aa1!${"x".repeat(1_000_000)}`)).toMatch(/72 UTF-8 bytes/)
  })

  it("supports non-ASCII upper/lower letters inside the bcrypt boundary", () => {
    expect(passwordPolicyError("Şifrə!Güclü42")).toBeNull()
  })
})
