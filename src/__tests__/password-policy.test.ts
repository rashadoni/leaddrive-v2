import { describe, expect, it } from "vitest"
import { passwordPolicyError, passwordRuleChecks } from "@/lib/password-policy"

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

// The user form shows these rules while the password is typed (owner,
// 2026-11-07: "show at the moment of typing whether it fits, not after Create").
// A checklist that turns all green for a password the server then refuses would
// be worse than none, so the two must agree on every input.
describe("passwordRuleChecks agrees with passwordPolicyError", () => {
  const corpus = [
    "", "a", "Cedar!Orbit-4829", "Password123!", "password123!", "lowercase1!only",
    "UPPERCASE1!ONLY", "NoNumbers!Here", "NoSpecial123Here", "Cedar Orbit!4829",
    `Aa1!${"x".repeat(7)}`, `Aa1!${"x".repeat(8)}`, `Aa1!${"x".repeat(68)}`, `Aa1!${"x".repeat(69)}`,
    `Aa1!${"​".repeat(8)}`, `Aa1!${"́".repeat(8)}`, "Şifrə!2026Bakı", "ПарольДлинный1!", `Aa1!${"я".repeat(35)}`,
    "Ədəd-Qutu-12345", "Aa1! bbbbbbbbb", "Tab\tTab1!Aaaaaa",
  ]
  it.each(corpus)("%j", (password) => {
    const checks = passwordRuleChecks(password)
    expect(Object.values(checks).every(Boolean)).toBe(passwordPolicyError(password) === null)
  })

  it("names the rule that fails", () => {
    expect(passwordRuleChecks("Cedar!Orbit-4829")).toEqual({
      length: true, uppercase: true, lowercase: true, digit: true, special: true,
      noSpaces: true, notTooLong: true, notCommon: true,
    })
    expect(passwordRuleChecks("cedarorbit")).toMatchObject({ length: false, uppercase: false, digit: false, special: false, lowercase: true })
    expect(passwordRuleChecks("Password123!").notCommon).toBe(false)
  })
})
