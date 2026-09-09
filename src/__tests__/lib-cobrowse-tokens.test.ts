/**
 * T8 Cobrowse — token-helper tests.
 */
import { describe, it, expect } from "vitest"
import {
  generateJoinToken,
  isValidJoinTokenShape,
  JOIN_TOKEN_LENGTH,
} from "@/lib/cobrowse/tokens"

describe("generateJoinToken", () => {
  it("returns a string of the expected length", () => {
    const t = generateJoinToken()
    expect(t).toHaveLength(JOIN_TOKEN_LENGTH)
  })

  it("returns a URL-safe base64 alphabet only", () => {
    for (let i = 0; i < 50; i++) {
      const t = generateJoinToken()
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it("never contains base64 padding or non-URL chars", () => {
    for (let i = 0; i < 50; i++) {
      const t = generateJoinToken()
      expect(t).not.toMatch(/[+/=]/)
    }
  })

  it("produces unique tokens (no obvious collisions in 200 draws)", () => {
    const set = new Set<string>()
    for (let i = 0; i < 200; i++) set.add(generateJoinToken())
    expect(set.size).toBe(200)
  })
})

describe("isValidJoinTokenShape", () => {
  it("accepts a freshly-generated token", () => {
    expect(isValidJoinTokenShape(generateJoinToken())).toBe(true)
  })

  it("rejects empty string", () => {
    expect(isValidJoinTokenShape("")).toBe(false)
  })

  it("rejects too-short string", () => {
    expect(isValidJoinTokenShape("a".repeat(JOIN_TOKEN_LENGTH - 1))).toBe(false)
  })

  it("rejects too-long string", () => {
    expect(isValidJoinTokenShape("a".repeat(JOIN_TOKEN_LENGTH + 1))).toBe(false)
  })

  it("rejects strings with `+`, `/`, or `=`", () => {
    const base = "a".repeat(JOIN_TOKEN_LENGTH - 1)
    expect(isValidJoinTokenShape(base + "+")).toBe(false)
    expect(isValidJoinTokenShape(base + "/")).toBe(false)
    expect(isValidJoinTokenShape(base + "=")).toBe(false)
  })

  it("rejects strings with whitespace", () => {
    expect(isValidJoinTokenShape("a".repeat(JOIN_TOKEN_LENGTH - 1) + " ")).toBe(false)
  })

  it("accepts characters at the alphabet boundaries", () => {
    expect(isValidJoinTokenShape("A".repeat(JOIN_TOKEN_LENGTH))).toBe(true)
    expect(isValidJoinTokenShape("0".repeat(JOIN_TOKEN_LENGTH))).toBe(true)
    expect(isValidJoinTokenShape("_".repeat(JOIN_TOKEN_LENGTH))).toBe(true)
    expect(isValidJoinTokenShape("-".repeat(JOIN_TOKEN_LENGTH))).toBe(true)
  })
})
