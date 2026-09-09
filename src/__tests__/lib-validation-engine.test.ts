/**
 * Tests for N5 Validation rules slice 1 — evaluation engine.
 * Pure functional, no Prisma. Uses N4 formula engine under the hood.
 */
import { describe, it, expect } from "vitest"
import {
  evaluateRules,
  recordToContext,
  type ValidationRuleInput,
} from "@/lib/validation/engine"

function rule(overrides: Partial<ValidationRuleInput> = {}): ValidationRuleInput {
  return {
    id: "r1",
    name: "Test rule",
    entityType: "deal",
    condition: "{x} < 0",
    errorField: null,
    errorMessage: "Test error",
    severity: "error",
    isActive: true,
    ...overrides,
  }
}

describe("N5 — recordToContext", () => {
  it("passes through scalar values", () => {
    const ctx = recordToContext({ a: 1, b: "x", c: true, d: null })
    expect(ctx).toEqual({ a: 1, b: "x", c: true, d: null })
  })

  it("preserves Date instances", () => {
    const d = new Date("2026-05-17")
    const ctx = recordToContext({ when: d })
    expect(ctx.when).toBe(d)
  })

  it("converts undefined to null", () => {
    const ctx = recordToContext({ a: undefined as unknown as null })
    expect(ctx.a).toBe(null)
  })

  it("drops arrays and nested objects (slice 1: scalars only)", () => {
    const ctx = recordToContext({
      arr: [1, 2, 3],
      nested: { k: "v" },
      ok: "scalar",
    })
    expect(ctx.ok).toBe("scalar")
    expect(ctx.arr).toBeUndefined()
    expect(ctx.nested).toBeUndefined()
  })

  it("rejects NaN/Infinity (drops them, not stores)", () => {
    const ctx = recordToContext({ bad: NaN, worse: Infinity, ok: 42 })
    expect(ctx.bad).toBeUndefined()
    expect(ctx.worse).toBeUndefined()
    expect(ctx.ok).toBe(42)
  })
})

describe("N5 — evaluateRules basic", () => {
  it("no rules → empty result", () => {
    const r = evaluateRules([], { x: 5 })
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.systemErrors).toEqual([])
  })

  it("rule fires when condition truthy → error", () => {
    const r = evaluateRules([rule()], { x: -5 })
    expect(r.errors.length).toBe(1)
    expect(r.errors[0].errorMessage).toBe("Test error")
    expect(r.errors[0].ruleId).toBe("r1")
  })

  it("rule does not fire when condition falsy", () => {
    const r = evaluateRules([rule()], { x: 5 })
    expect(r.errors).toEqual([])
  })

  it("skips inactive rules", () => {
    const r = evaluateRules([rule({ isActive: false })], { x: -5 })
    expect(r.errors).toEqual([])
  })

  it("severity=warning routes to warnings, not errors", () => {
    const r = evaluateRules([rule({ severity: "warning" })], { x: -5 })
    expect(r.errors).toEqual([])
    expect(r.warnings.length).toBe(1)
  })

  it("multiple rules — independent firing", () => {
    const rules = [
      rule({ id: "r1", condition: "{a} < 0", errorMessage: "A negative" }),
      rule({ id: "r2", condition: "{b} > 100", errorMessage: "B too big" }),
    ]
    const r = evaluateRules(rules, { a: -1, b: 200 })
    expect(r.errors.length).toBe(2)
    expect(r.errors.map(e => e.ruleId).sort()).toEqual(["r1", "r2"])
  })

  it("malformed formula goes to systemErrors, not blocks user", () => {
    const r = evaluateRules([rule({ condition: "{x} + " })], { x: 5 })
    expect(r.errors).toEqual([])
    expect(r.systemErrors.length).toBe(1)
    expect(r.systemErrors[0].systemError).toBe(true)
    expect(r.systemErrors[0].errorMessage).toContain("broken formula")
  })

  it("propagates errorField for UI field-highlight", () => {
    const r = evaluateRules([rule({ errorField: "amount", condition: "{amount} < 0" })], { amount: -5 })
    expect(r.errors[0].errorField).toBe("amount")
  })
})

describe("N5 — truthy semantics", () => {
  it("condition returning 0 → falsy → no error", () => {
    const r = evaluateRules([rule({ condition: "0" })], {})
    expect(r.errors).toEqual([])
  })

  it("condition returning empty string → falsy → no error", () => {
    const r = evaluateRules([rule({ condition: '""' })], {})
    expect(r.errors).toEqual([])
  })

  it("condition returning null → falsy → no error", () => {
    const r = evaluateRules([rule({ condition: "NULL" })], {})
    expect(r.errors).toEqual([])
  })

  it("condition returning TRUE → truthy → error", () => {
    const r = evaluateRules([rule({ condition: "TRUE" })], {})
    expect(r.errors.length).toBe(1)
  })

  it("condition returning non-zero number → truthy → error", () => {
    const r = evaluateRules([rule({ condition: "1" })], {})
    expect(r.errors.length).toBe(1)
  })

  it("condition returning non-empty string → truthy → error", () => {
    const r = evaluateRules([rule({ condition: '"x"' })], {})
    expect(r.errors.length).toBe(1)
  })
})

describe("N5 — Salesforce-style rule examples", () => {
  it("negative-budget rule", () => {
    const r = evaluateRules(
      [rule({ condition: "{budget} < 0", errorMessage: "Budget cannot be negative", errorField: "budget" })],
      { budget: -50 }
    )
    expect(r.errors[0].errorMessage).toBe("Budget cannot be negative")
    expect(r.errors[0].errorField).toBe("budget")
  })

  it("required-email-when-priority-high rule", () => {
    const ruleSpec = rule({
      condition: '{priority} == "high" AND ISBLANK({email})',
      errorMessage: "Email is required for high-priority records",
      errorField: "email",
    })
    expect(evaluateRules([ruleSpec], { priority: "high", email: null }).errors.length).toBe(1)
    expect(evaluateRules([ruleSpec], { priority: "high", email: "a@b.com" }).errors.length).toBe(0)
    expect(evaluateRules([ruleSpec], { priority: "low", email: null }).errors.length).toBe(0)
  })

  it("close-date-must-be-future rule", () => {
    const ruleSpec = rule({
      condition: "{closeDate} < TODAY()",
      errorMessage: "Close date must be in the future",
      errorField: "closeDate",
    })
    const now = new Date(2026, 4, 17, 12, 0, 0) // May 17, 2026
    const past = new Date(2026, 4, 10) // May 10
    const future = new Date(2026, 5, 10) // June 10
    expect(evaluateRules([ruleSpec], { closeDate: past }, now).errors.length).toBe(1)
    expect(evaluateRules([ruleSpec], { closeDate: future }, now).errors.length).toBe(0)
  })

  it("discount-cap rule with arithmetic", () => {
    const ruleSpec = rule({
      condition: "{discountPercent} > 30",
      errorMessage: "Discount cannot exceed 30% without manager approval",
      errorField: "discountPercent",
    })
    expect(evaluateRules([ruleSpec], { discountPercent: 35 }).errors.length).toBe(1)
    expect(evaluateRules([ruleSpec], { discountPercent: 25 }).errors.length).toBe(0)
  })

  it("compound condition with AND", () => {
    const ruleSpec = rule({
      condition: '{stage} == "CLOSED_WON" AND {valueAmount} == 0',
      errorMessage: "Won deal must have a positive value",
    })
    expect(evaluateRules([ruleSpec], { stage: "CLOSED_WON", valueAmount: 0 }).errors.length).toBe(1)
    expect(evaluateRules([ruleSpec], { stage: "CLOSED_WON", valueAmount: 100 }).errors.length).toBe(0)
    expect(evaluateRules([ruleSpec], { stage: "OPEN", valueAmount: 0 }).errors.length).toBe(0)
  })

  it("warning + error together", () => {
    const rules = [
      rule({ id: "r1", condition: "{amount} < 0", errorMessage: "Amount negative", severity: "error" }),
      rule({ id: "r2", condition: "{amount} > 1000000", errorMessage: "Large amount", severity: "warning" }),
    ]
    const r = evaluateRules(rules, { amount: -50 })
    expect(r.errors.length).toBe(1)
    expect(r.warnings.length).toBe(0)

    const r2 = evaluateRules(rules, { amount: 2000000 })
    expect(r2.errors.length).toBe(0)
    expect(r2.warnings.length).toBe(1)
  })
})

describe("N5 — record-context coercion in rules", () => {
  it("missing field resolves to null in formula", () => {
    const r = evaluateRules(
      [rule({ condition: "ISNULL({nonexistent})", errorMessage: "Field missing" })],
      { other: 1 }
    )
    expect(r.errors.length).toBe(1)
  })

  it("nested object fields are dropped — rule cannot reference them in slice 1", () => {
    const r = evaluateRules(
      [rule({ condition: "ISNULL({nested})", errorMessage: "Slice 1 limitation" })],
      { nested: { foo: "bar" } }
    )
    // `nested` dropped → context has no field → resolves to null → ISNULL=true → error fires
    expect(r.errors.length).toBe(1)
  })
})
