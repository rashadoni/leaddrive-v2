/**
 * Tests for the residual merge-variable scanner (Contract Editor Slice 1, Step 5).
 * Gates "Send for approval" — must find every unresolved {{var}}, dedupe, and
 * REPORT (not skip) prototype-chain names so a stray {{__proto__}} blocks send.
 */
import { describe, it, expect } from "vitest"
import { findResidualVars, hasUnresolvedVars } from "@/lib/clm/residual-vars"

describe("findResidualVars", () => {
  it("finds distinct tokens in first-seen order", () => {
    expect(findResidualVars("Pay {{amount}} to {{party}} by {{due_date}}.")).toEqual([
      "amount",
      "party",
      "due_date",
    ])
  })

  it("dedupes repeated tokens", () => {
    expect(findResidualVars("{{x}} and {{x}} again, then {{y}}")).toEqual(["x", "y"])
  })

  it("tolerates surrounding whitespace (mirrors the substituter grammar)", () => {
    expect(findResidualVars("{{ spaced }} and {{tight}}")).toEqual(["spaced", "tight"])
  })

  it("REPORTS prototype-chain names (does NOT skip them like the substituter)", () => {
    expect(findResidualVars("danger {{__proto__}} {{constructor}}")).toEqual([
      "__proto__",
      "constructor",
    ])
  })

  it("ignores malformed / non-grammar tokens", () => {
    expect(findResidualVars("{{1bad}} {{ has-dash }} {{}} {single} plain")).toEqual([])
  })

  it("empty / null / fully-resolved → []", () => {
    expect(findResidualVars("")).toEqual([])
    expect(findResidualVars(null)).toEqual([])
    expect(findResidualVars("No variables here, all filled in.")).toEqual([])
  })

  it("is deterministic across repeated calls (global regex reset)", () => {
    const t = "{{a}} {{b}}"
    expect(findResidualVars(t)).toEqual(["a", "b"])
    expect(findResidualVars(t)).toEqual(["a", "b"]) // not affected by prior lastIndex
  })
})

describe("hasUnresolvedVars", () => {
  it("true when a token remains, false when fully resolved", () => {
    expect(hasUnresolvedVars("Owed: {{amount}}")).toBe(true)
    expect(hasUnresolvedVars("Owed: $500")).toBe(false)
    expect(hasUnresolvedVars(null)).toBe(false)
  })
})
